/**
 * 千牛自动化核心
 * 1. 读取消息（截图+OCR）
 * 2. 监听新消息（定时轮询）
 * 3. 自动回复（发送文本）
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ============ 弹窗检测与关闭 =================

/**
 * 检测并关闭千牛弹窗
 * 返回是否检测到弹窗
 */
function closePopups(): boolean {
  let popupClosed = false;
  
  // 方法1: 通过 AppleScript 关闭窗口
  const script = `
    tell application "System Events"
      tell process "${ALIWORKBENCH}"
        set popupFound to false
        -- 尝试关闭通知弹窗（包括"单聊消息"、"新消息"等）
        try
          set wns to every window whose name contains "通知" or name contains "消息" or name contains "提示" or name contains "单聊"
          if (count of wns) > 0 then
            set popupFound to true
            repeat with w in wns
              try
                set closeBtn to button 1 of w
                click closeBtn
              end try
            end repeat
          end if
        end try
        
        -- 尝试关闭右下角气泡通知
        try
          set notifs to every static text whose value contains "有新的"
          if (count of notifs) > 0 then
            set popupFound to true
          end if
        end try
        
        return popupFound
      end tell
    end tell
  `;
  
  try {
    const result = runScript(script).trim();
    popupClosed = result === 'true';
  } catch {}
  
  // 方法2: 按 ESC 键关闭弹窗（很多弹窗按 ESC 可以关闭）
  if (!popupClosed) {
    try {
      runScript('tell application "System Events" to keystroke escape');
      execSync('sleep 0.2');
      popupClosed = true;
    } catch {}
  }
  
  // 方法3: 点击屏幕中央/通知区域关闭（针对右下角气泡）
  if (!popupClosed) {
    // 点击右下角通知区域尝试关闭
    try {
      execSync('osascript -e \'tell application "System Events" to click at {1800, 900}\'', { timeout: 1000 });
      execSync('sleep 0.2');
    } catch {}
  }
  
  return popupClosed;
}

/**
 * 获取聊天窗口位置（通过 AppleScript）
 * 返回窗口位置和大小
 */
function getChatWindowPosition(): { x: number; y: number; w: number; h: number } | null {
  // 用 AppleScript 获取千牛聊天窗口的实际位置
  const script = `
    tell application "System Events"
      tell process "Aliworkbench"
        -- 查找单聊窗口
        set chatWindow to missing value
        try
          set allWindows to every window
          repeat with w in allWindows
            set winName to name of w
            if winName contains "单聊" then
              set chatWindow to w
              exit repeat
            end if
          end repeat
        end try
        
        if chatWindow is missing value then
          return "NOT_FOUND"
        end if
        
        -- 获取窗口位置和大小
        set winPos to position of chatWindow
        set winSize to size of chatWindow
        
        return (item 1 of winPos) & "," & (item 2 of winPos) & "," & (item 1 of winSize) & "," & (item 2 of winSize)
      end tell
    end tell
  `;
  
  try {
    const result = runScript(script).trim();
    if (result === 'NOT_FOUND') {
      return null;
    }
    
    const [x, y, w, h] = result.split(',').map(Number);
    
    // 聊天内容区域在窗口内部，需要偏移
    // 假设标题栏高度约 50，聊天内容从 y+50 开始
    return {
      x: x + 20,      // 左侧留白
      y: y + 60,      // 标题栏下方
      w: w - 40,      // 右侧留白
      h: h - 150      // 底部留给输入框
    };
  } catch (e) {
    console.log('⚠️ 获取窗口位置失败:', e);
    return null;
  }
}

/**
 * 最小化其他窗口，避免遮挡
 */
function minimizeOtherWindows(): void {
  const script = `
    tell application "System Events"
      tell process "${ALIWORKBENCH}"
        set frontmost to true
      end tell
    end tell
  `;
  runScript(script);
}
import { screenshot, screenshotChat, recognizeText, detectChanges } from './ocr';
import {
  listWindows,
  getWindowRect,
  clickAt,
  recordPoint,
  replayPoint,
  listPoints,
  deletePoint,
  interactiveRecord,
  testAll
} from './recorder';
import {
  captureRegion,
  captureRect,
  showTemplates,
  deleteTemplate,
  openTemplate,
  findTemplate,
  hasNewMessage
} from './template';
import {
  generateReply,
  loadConfig,
  getConfig,
  listRules,
  addRule,
  deleteRule,
  toggleRule,
  CONFIG_PATH,
  ReplyRule
} from './reply';

// ============ 配置 =================

const ALIWORKBENCH = 'Aliworkbench';

// 接待中心窗口坐标（已知值）
const RECEPTION = { x: 27, y: 38, w: 1310, h: 800 };

// 买家头像在窗口内的位置（相对于窗口左上角）
// 从 UI 树探测得到
const BUYER_POSITIONS: Record<string, { x: number; y: number; name: string }> = {
  'cyanbukkit': { x: 410, y: 628, name: 'CyanBukkit' },
  'tb990070112114': { x: 410, y: 714, name: 'tb990070112114' }
};

// 聊天输入框坐标（屏幕坐标，需标定）
const INPUT_BOX_POS = { x: 500, y: 1030 };

// ============ AppleScript 工具 =================

function runScript(script: string): string {
  const tmpPath = `/tmp/qianniu-script-${Date.now()}.scpt`;
  fs.writeFileSync(tmpPath, script);
  try {
    return execSync(`osascript ${tmpPath}`, { timeout: 20000, encoding: 'utf8' }).trim();
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

function pressKey(key: string): void {
  runScript(`tell application "System Events" to keystroke "${key}"`);
}

function activateApp(name: string): void {
  runScript(`tell application "${name}" to activate`);
}

/**
 * 激活接待中心窗口
 * 千牛可能有多个窗口，需要确保打开的是接待中心
 */
function activateReception(): void {
  // 直接激活千牛应用即可
  // 千牛打开后会自动显示上次关闭时的窗口（包括接待中心）
  activateApp(ALIWORKBENCH);
  execSync('sleep 0.5');
}

/**
 * 从 recordings.json 加载记录的坐标点
 */
function loadRecordedPoint(pointName: string): { x: number; y: number } | null {
  const recordingsPath = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/recordings.json';
  if (!fs.existsSync(recordingsPath)) return null;
  
  try {
    const data = JSON.parse(fs.readFileSync(recordingsPath, 'utf8'));
    const point = data.points?.find((p: any) => p.name === pointName);
    if (!point) return null;
    
    // 获取窗口实际位置
    const windowScript = `
      tell application "System Events"
        tell process "${ALIWORKBENCH}"
          try
            tell window "${point.windowName}"
              set p to position
              set s to size
              return (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s)
            end tell
          on error
            return "NOT_FOUND"
          end try
        end tell
      end tell
    `;
    
    const result = runScript(windowScript);
    if (result === 'NOT_FOUND' || !result) return null;
    
    const parts = result.split(',').filter((s: string) => s.trim()).map((s: string) => parseInt(s.trim(), 10));
    if (parts.length < 4) return null;
    
    const [wx, wy, ww, wh] = parts;
    // 根据比例计算实际坐标
    const x = Math.round(wx + point.ratioX * ww);
    const y = Math.round(wy + point.ratioY * wh);
    
    return { x, y };
  } catch (e) {
    console.error('加载记录点失败:', e);
    return null;
  }
}

function sendTextViaClipboard(text: string): void {
  // 先复制到剪贴板
  execSync(`echo '${text.replace(/'/g, "\\'")}' | pbcopy`);
  // Command+V 粘贴
  runScript(`tell application "System Events" to keystroke "v" using command down`);
  // 回车发送
  runScript(`tell application "System Events" to keystroke return`);
}

// ============ 窗口管理 =================

// 已移到 recorder.ts

// ============ 读取买家列表 =================

interface Buyer {
  id: string;
  name: string;
  x: number;   // 屏幕坐标
  y: number;
}

/**
 * 探测接待中心当前买家列表
 * 通过遍历窗口内所有 AXGroup 来找
 */
function scanBuyerList(): Buyer[] {
  const script = `
    tell application "System Events"
      tell process "${ALIWORKBENCH}"
        set out to ""
        tell window "t_1487330154436_074-接待中心"
          set g1 to group 1
          set axg to UI element 1 of g1
          repeat with i from 1 to count of UI elements of axg
            try
              set elem to UI element i of axg
              set nm to name of elem
              set pos to position of elem
              set sz to size of elem
              if nm is not missing value then
                set out to out & nm & "|" & (item 1 of pos) & "," & (item 2 of pos) & "|" & (item 1 of sz) & "," & (item 2 of sz) & ";"
              end if
            end try
          end repeat
        end tell
      end tell
    end tell
  `;

  const result = runScript(script);
  const buyers: Buyer[] = [];

  result.split(';').filter(Boolean).forEach(seg => {
    const parts = seg.split('|');
    if (parts.length >= 2 && parts[0]) {
      const [x, y] = parts[1].split(',').map(Number);
      buyers.push({
        id: parts[0],
        name: parts[0],
        x: x + 10,   // 点击区域中心
        y: y + 26    // 头像中间
      });
    }
  });

  return buyers;
}

// ============ 聊天操作 =================

/**
 * 点击进入指定买家的聊天
 */
function openChat(buyer: Buyer): void {
  activateReception();
  execSync('sleep 0.5');
  clickAt(buyer.x, buyer.y);
  execSync('sleep 1.5');
}

/**
 * 读取当前聊天消息（截图+OCR）
 */
/**
 * 读取保存的校准配置
 * 动态获取当前窗口位置 + 偏移量
 */
function loadCalibrateConfig(): { x: number; y: number; w: number; h: number } | null {
  const configPath = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/calibrate.json';
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      // 检查是否有绝对坐标配置（优先使用）
      if (config.x !== undefined && config.y !== undefined) {
        return {
          x: config.x,
          y: config.y,
          w: config.w || 500,
          h: config.h || 300
        };
      }
      
      // 检查是否有偏移量配置
      if (config.offsetX !== undefined && config.offsetY !== undefined) {
        // 获取当前千牛窗口位置 - 使用索引而不是窗口名称
        const getCurrentWindowPos = (): { x: number; y: number; w: number; h: number } | null => {
          try {
            // 使用窗口索引1（第一个窗口）代替窗口名称
            const posScript = `tell application "System Events" to tell process "Aliworkbench" to get position of window 1`;
            const sizeScript = `tell application "System Events" to tell process "Aliworkbench" to get size of window 1`;
            
            const posResult = execSync(`osascript -e '${posScript}'`, { encoding: 'utf8' }).trim();
            const sizeResult = execSync(`osascript -e '${sizeScript}'`, { encoding: 'utf8' }).trim();
            
            const [x, y] = posResult.split(',').map(s => parseInt(s.trim(), 10));
            const [w, h] = sizeResult.split(',').map(s => parseInt(s.trim(), 10));
            
            if (isNaN(x) || isNaN(y)) return null;
            return { x, y, w, h };
          } catch {
            return null;
          }
        };
        
        const winPos = getCurrentWindowPos();
        if (winPos) {
          // 当前窗口位置 + 配置的偏移 = 实际截图位置
          return {
            x: winPos.x + config.offsetX,
            y: winPos.y + config.offsetY,
            w: config.chatW || 500,
            h: config.chatH || 300
          };
        }
      }
    }
  } catch {}
  return null;
}

/**
 * 读取当前聊天消息（截图+OCR）
 */
async function readMessages(): Promise<string[]> {
  const chatPath = '/tmp/qianniu-chat.png';
  
  let chatX: number, chatY: number, chatW = 900, chatH = 500;
  
  // 1. 优先使用保存的校准绝对坐标
  const calibrate = loadCalibrateConfig();
  if (calibrate) {
    chatX = calibrate.x;
    chatY = calibrate.y;
    chatW = calibrate.w;
    chatH = calibrate.h;
    console.log(`📍 使用标定坐标: (${chatX}, ${chatY}) ${chatW}x${chatH}`);
  } else {
    // 2. 尝试获取聊天窗口位置
    const windowPos = getChatWindowPosition();
    if (windowPos) {
      chatX = windowPos.x;
      chatY = windowPos.y;
      chatW = windowPos.w;
      chatH = windowPos.h;
    } else {
      // 3. 使用默认坐标
      const { x, y } = RECEPTION;
      chatX = x + 260;
      chatY = y + 50;
      console.log(`📍 使用默认坐标: (${chatX}, ${chatY})`);
    }
  }

  screenshot(chatX, chatY, chatW, chatH, chatPath);

  // OCR
  const text = await recognizeText(chatPath);

  // 强制清理截图文件
  try { fs.unlinkSync(chatPath); } catch {}

  // 简单过滤
  const lines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 1 && !l.match(/^(ERROR|OCR)/));

  return lines;
}

/**
 * 发送回复
 * 完整流程：
 * 1. 激活接待中心窗口
 * 2. 点击"新的客户咨询"（如果有弹窗）
 * 3. 点击聊天区域
 * 4. 复制到剪贴板 → 粘贴 → 发送
 */
function sendReply(text: string): boolean {
  try {
    console.log('📤 开始发送回复...');
    
    // 1. 激活接待中心窗口
    console.log('  → 激活接待中心窗口');
    activateReception();
    execSync('sleep 0.5');
    
    // 2. 检测并点击"新的客户咨询"弹窗
    console.log('  → 检查新客户咨询弹窗');
    const newConsultPoint = loadRecordedPoint('新的客户咨询');
    if (newConsultPoint) {
      console.log(`  → 点击"新的客户咨询": (${newConsultPoint.x}, ${newConsultPoint.y})`);
      clickAt(newConsultPoint.x, newConsultPoint.y);
      execSync('sleep 0.8');
    } else {
      console.log('  ⚠️ 未找到"新的客户咨询"坐标');
    }
    
    // 3. 点击聊天区域（消息输入框位置）
    console.log('  → 点击聊天区域');
    const chatAreaPoint = loadRecordedPoint('聊天区域');
    if (chatAreaPoint) {
      console.log(`  → 点击聊天输入框: (${chatAreaPoint.x}, ${chatAreaPoint.y})`);
      clickAt(chatAreaPoint.x, chatAreaPoint.y);
      execSync('sleep 0.3');
    } else {
      console.log('  ⚠️ 未找到"聊天区域"坐标，尝试使用标定配置');
      // 备选：使用 calibrate.json 中的坐标
      const calibrate = loadCalibrateConfig();
      if (calibrate) {
        // 点击聊天区域中间位置
        const inputX = calibrate.x + calibrate.w / 2;
        const inputY = calibrate.y + calibrate.h - 30;
        console.log(`  → 使用备选坐标: (${inputX}, ${inputY})`);
        clickAt(inputX, inputY);
        execSync('sleep 0.3');
      }
    }
    
    // 4. 复制到剪贴板 → 粘贴 → 发送
    console.log('  → 粘贴并发送');
    sendTextViaClipboard(text);
    
    console.log('  ✅ 发送完成');
    return true;
  } catch (e) {
    console.error('发送失败:', e);
    return false;
  }
}

// ============ 监听循环 =================

let lastMessageText = '';
let isRunning = false;
let autoReplyEnabled = true; // 是否启用自动回复
let lastSentReply = '';      // 上次发送的回复内容
let lastSentTime = 0;       // 上次发送的时间
const COOLDOWN_MS = 60000;  // 发送冷却时间（1分钟内不重复发送）

// 已发送消息记录文件
const SENT_MESSAGES_FILE = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/sent-messages.json';

/**
 * 加载已发送消息记录
 */
function loadSentMessages(): Set<string> {
  try {
    if (fs.existsSync(SENT_MESSAGES_FILE)) {
      const data = JSON.parse(fs.readFileSync(SENT_MESSAGES_FILE, 'utf8'));
      const msgList: string[] = data.messages || [];
      const messages = new Set<string>(msgList);
      // 清理超过7天的记录
      const now = Date.now();
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
      const times = data.times as Record<string, number>;
      for (const msg of messages) {
        if (times && times[msg] && times[msg] < weekAgo) {
          messages.delete(msg);
        }
      }
      return messages;
    }
  } catch {}
  return new Set<string>();
}

/**
 * 保存已发送消息
 */
function saveSentMessage(message: string): void {
  try {
    let data = { messages: [], times: {} };
    if (fs.existsSync(SENT_MESSAGES_FILE)) {
      data = JSON.parse(fs.readFileSync(SENT_MESSAGES_FILE, 'utf8'));
    }
    if (!data.messages) data.messages = [];
    if (!data.times) data.times = {};
    
    if (!data.messages.includes(message)) {
      data.messages.push(message);
    }
    data.times[message] = Date.now();
    
    // 只保留最近100条
    if (data.messages.length > 100) {
      data.messages = data.messages.slice(-100);
    }
    
    fs.writeFileSync(SENT_MESSAGES_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

/**
 * 检查是否已经发送过这条消息
 */
function hasBeenSent(message: string): boolean {
  const sentMessages = loadSentMessages();
  return sentMessages.has(message);
}

/**
 * 主监听循环
 */
async function monitorCycle(intervalMs = 5000) {
  console.log(`\n⏳ 监听中，每 ${intervalMs / 1000}s 检查一次...`);
  console.log(`🤖 自动回复: ${autoReplyEnabled ? '已启用' : '已禁用'}`);
  console.log('按 Ctrl+C 停止\n');

  // 激活接待中心窗口
  activateReception();
  execSync('sleep 0.3');

  // 加载回复配置
  const replyConfig = loadConfig();
  console.log(`📋 已加载 ${replyConfig.rules.filter(r => r.enabled).length} 条生效规则\n`);

  while (isRunning) {
    try {
      // 每次循环先检测并关闭弹窗
      const hadPopup = closePopups();
      if (hadPopup) {
        console.log('🔔 已关闭弹窗');
        execSync('sleep 0.3');
      }
      
      const messages = await readMessages();
      const currentText = messages.join('\n');

      // 首次启动时不发送（lastMessageText为空）
      // 并且要确保有新消息变化才处理
      const hasNewChanges = currentText !== lastMessageText && lastMessageText !== '';
      
      if (hasNewChanges) {
        const newLines = detectChanges(lastMessageText, currentText);
        if (newLines.length > 0) {
          console.log('\n🆕 检测到新消息:');
          newLines.forEach(l => console.log(`  > ${l}`));
          
          // 尝试识别买家ID（从消息中提取）
          const buyerId = 'current-buyer'; // 简化处理
          
          // 自动回复
          if (autoReplyEnabled) {
            // 取最新一条买家消息
            const latestBuyerMsg = newLines[newLines.length - 1];
            const reply = generateReply(buyerId, latestBuyerMsg);
            
            if (reply) {
              // 检查是否已发送过相同回复（冷却时间内不重复）
              const now = Date.now();
              const isSameAsLastReply = reply === lastSentReply && (now - lastSentTime) < COOLDOWN_MS;
              const hasSentBefore = hasBeenSent(reply);
              
              if (isSameAsLastReply) {
                console.log(`\n⏳ 跳过: 同一回复在冷却时间内`);
              } else if (hasSentBefore) {
                console.log(`\n⏳ 跳过: 该回复之前已发送过`);
              } else {
                console.log(`\n🤖 自动回复: ${reply}`);
                // 自动发送
                const ok = sendReply(reply);
                if (ok) {
                  console.log('✅ 已自动发送');
                  // 记录发送
                  lastSentReply = reply;
                  lastSentTime = now;
                  saveSentMessage(reply);
                } else {
                  console.log('❌ 自动回复失败');
                }
              }
            }
          }
          
          console.log('\n💬 当前全部消息:');
          messages.slice(-6).forEach(m => console.log(`  ${m}`));
        }
      }

      lastMessageText = currentText;
    } catch (e) {
      console.error('读取失败:', e);
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }
}

/**
 * 巡店模式：扫描所有买家，处理待回复
 */
async function patrolCycle() {
  console.log('🔍 开始巡店...\n');

  activateReception();
  execSync('sleep 1');

  const buyers = scanBuyerList();
  console.log(`发现 ${buyers.length} 个接待中:`, buyers.map(b => b.name).join(', '));

  for (const buyer of buyers) {
    console.log(`\n👉 进入 ${buyer.name}...`);
    openChat(buyer);

    const messages = await readMessages();
    console.log(`  消息 (${messages.length} 条):`);
    messages.slice(-4).forEach(m => console.log(`    ${m}`));

    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      // 这里接 AI 回复逻辑
      console.log(`  最新: ${lastMsg}`);
    }
  }

  console.log('\n✅ 巡店完成');
}

// ============ 命令行 =================

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'monitor';

  activateReception();
  execSync('sleep 0.5');

  switch (cmd) {
    case 'monitor':
      isRunning = true;
      await monitorCycle(5000);
      break;

    case 'patrol':
      await patrolCycle();
      break;

    case 'read':
      const buyers = scanBuyerList();
      console.log('买家列表:', buyers);
      if (buyers.length > 0) {
        console.log('\n读取第一个买家消息...');
        openChat(buyers[0]);
        const msgs = await readMessages();
        console.log('\n消息列表:');
        msgs.forEach(m => console.log(`  ${m}`));
      }
      break;

    case 'snapshot':
      // 调试：截取当前聊天区域并保存（不删除）
      console.log('截取聊天区域...');
      
      // 优先使用标定坐标
      const snapCalibrate = loadCalibrateConfig();
      let snapX: number, snapY: number, snapW = 496, snapH = 381;
      
      if (snapCalibrate) {
        snapX = snapCalibrate.x;
        snapY = snapCalibrate.y;
        snapW = snapCalibrate.w;
        snapH = snapCalibrate.h;
        console.log(`📍 使用标定坐标: (${snapX}, ${snapY}) ${snapW}x${snapH}`);
      } else {
        // 没有标定时使用默认坐标
        const { x, y } = RECEPTION;
        snapX = x + 260;
        snapY = y + 50;
        console.log(`📍 使用默认坐标: (${snapX}, ${snapY})`);
      }
      
      const snapPath = `/tmp/qianniu-debug-${Date.now()}.png`;
      screenshot(snapX, snapY, snapW, snapH, snapPath);
      
      // 检查截图是否成功
      if (!fs.existsSync(snapPath)) {
        console.error('❌ 截图失败！请检查千牛窗口是否已打开');
        break;
      }
      
      console.log(`✅ 已保存到: ${snapPath}`);
      execSync(`open ${snapPath}`);
      break;

    case 'ocr-test': {
      // 调试：测试 OCR 识别
      console.log('截取并识别...\n');
      
      // 调试模式：先保存截图
      const debugPath = '/tmp/qianniu-ocr-debug.png';
      
      let testX: number, testY: number, testW = 900, testH = 500;
      const calibrate = loadCalibrateConfig();
      if (calibrate) {
        testX = calibrate.x;
        testY = calibrate.y;
        testW = calibrate.w;
        testH = calibrate.h;
        console.log(`📍 使用标定坐标: (${testX}, ${testY}) ${testW}x${testH}`);
      } else {
        const { x, y } = RECEPTION;
        testX = x + 260;
        testY = y + 50;
        console.log(`📍 使用默认坐标: (${testX}, ${testY})`);
      }
      
      // 先截取保存
      screenshot(testX, testY, testW, testH, debugPath);
      
      // 检查截图是否成功创建
      if (!fs.existsSync(debugPath)) {
        console.error('❌ 截图失败！请检查：');
        console.error('  1. 千牛窗口是否已打开');
        console.error('  2. 坐标是否正确 (可能超出屏幕范围)');
        console.error('  3. 尝试运行: npm run dev calibrate 重新标定坐标');
        break;
      }
      
      console.log(`📸 截图已保存: ${debugPath}`);
      
      // OCR 识别
      const msgs2 = await recognizeText(debugPath);
      console.log('OCR 识别结果:');
      console.log(msgs2.length ? msgs2 : '(无内容)');
      
      // 如果截图还存在就打开（recognizeText会删除，所以加判断）
      if (fs.existsSync(debugPath)) {
        execSync(`open ${debugPath}`);
      } else {
        console.log('💡 提示: 截图已被 OCR 函数清理，如需查看请先运行: npm run dev snapshot');
      }
      break;
    }

    case 'send':
      if (args[1]) {
        console.log(`发送: ${args[1]}`);
        const ok = sendReply(args[1]);
        console.log(ok ? '✅ 发送成功' : '❌ 发送失败');
      } else {
        console.log('用法: npm run dev send "消息内容"');
      }
      break;

    case 'windows':
      console.log('窗口列表:');
      listWindows().forEach(w => console.log(`  ${w.name} (${w.rect.x},${w.rect.y}) ${w.rect.w}x${w.rect.h}`));
      break;

    case 'buyers':
      console.log('买家列表:');
      scanBuyerList().forEach(b => console.log(`  ${b.id} @(${b.x},${b.y})`));
      break;

    case 'calibrate': {
      // 智能标定模式
      console.log('=== 智能坐标标定 ===');
      console.log('请按步骤操作，程序会自动计算聊天区域位置\n');
      
      // 激活接待中心
      activateReception();
      execSync('sleep 0.5');
      
      // 步骤1: 获取接待中心窗口位置
      console.log('📋 步骤1: 获取千牛接待中心窗口位置...');
      const getWindowPos = (): { x: number; y: number; w: number; h: number } | null => {
        const script = `
          tell application "System Events"
            tell process "Aliworkbench"
              set w to window "t_1487330154436_074-接待中心"
              set pos to position of w
              set sz to size of w
              return (item 1 of pos) & "," & (item 2 of pos) & "," & (item 1 of sz) & "," & (item 2 of sz)
            end tell
          end tell
        `;
        try {
          const result = runScript(script).trim();
          const [x, y, w, h] = result.split(',').map(Number);
          return { x, y, w, h };
        } catch {
          return null;
        }
      };
      
      const winPos = getWindowPos();
      if (!winPos) {
        console.log('❌ 无法获取千牛窗口，请确保千牛已打开接待中心');
        break;
      }
      console.log(`  窗口位置: (${winPos.x}, ${winPos.y}) 大小: ${winPos.w}x${winPos.h}`);
      
      // 步骤2: 让用户框选聊天区域
      console.log('\n📋 步骤2: 请框选聊天消息区域');
      console.log('  → 现在请用鼠标框选聊天消息区域（不要框选输入框）');
      console.log('  → 框选后程序会自动计算相对位置\n');
      
      execSync('sleep 1');
      
      // 用交互式截图
      const chatPath = '/tmp/qianniu-calibrate-chat.png';
      try {
        execSync(`screencapture -i -x "${chatPath}"`, { timeout: 30000 });
      } catch {
        console.log('❌ 取消框选');
        break;
      }
      
      // 获取截图的尺寸，然后让用户点击四个角
      // 由于无法直接获取框选位置，改用点击方式
      console.log('\n📋 步骤3: 请点击聊天区域的四个角（按回车确认每一步）');
      console.log('  1. 左上角 → 回车');
      console.log('  2. 右下角 → 回车\n');
      
      // 简化：直接获取截图本身的位置信息不够
      // 改用更简单的方法：让用户在窗口内点击两个点
      
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      
      const ask = (prompt: string): Promise<void> => {
        return new Promise(resolve => rl.question(prompt, () => resolve()));
      };
      
      // 获取鼠标位置 - 用 cliclick
      const getMousePos = (): number[] => {
        try {
          const pos = execSync('cliclick p', { encoding: 'utf8' }).trim();
          return pos.split(',').map(Number);
        } catch {
          return [0, 0];
        }
      };
      
      await ask('请将鼠标移到聊天区域左上角，然后回车: ');
      const tl = getMousePos();
      
      await ask('请将鼠标移到聊天区域右下角，然后回车: ');
      const br = getMousePos();
      
      rl.close();
      
      // 计算聊天区域大小
      const chatW = br[0] - tl[0];
      const chatH = br[1] - tl[1];
      
      // 计算相对于窗口的偏移量
      const offsetX = tl[0] - winPos.x;
      const offsetY = tl[1] - winPos.y;
      
      console.log('\n=== 标定完成 ===');
      console.log(`窗口位置: (${winPos.x}, ${winPos.y})`);
      console.log(`聊天区域偏移: (${offsetX}, ${offsetY})`);
      console.log(`聊天区域大小: ${chatW}x${chatH}\n`);
      
      // 保存到配置文件 - 保存相对偏移量
      const configPath = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/calibrate.json';
      const config = {
        // 记录标定时的窗口位置
        windowX: winPos.x,
        windowY: winPos.y,
        // 聊天区域相对于窗口的偏移
        offsetX: offsetX,
        offsetY: offsetY,
        // 聊天区域大小
        chatW: chatW,
        chatH: chatH,
        calibratedAt: new Date().toISOString()
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`✅ 已保存到: ${configPath}`);
      console.log('\n现在可以运行 npm run dev ocr-test 测试识别效果');
      break;
    }

    case 'record':
      // 录制模式
      interactiveRecord();
      break;

    case 'replay':
      // 回放录制点
      if (args[1]) {
        replayPoint(args[1]);
      } else {
        console.log('用法: npm run dev replay <点名称>');
        listPoints();
      }
      break;

    case 'points':
      // 列出所有录制点
      listPoints();
      break;

    case 'test-points':
      testAll();
      break;

    case 'capture':
      // 交互式选区截图（捕获模板）
      if (args[1]) {
        captureRegion(args[1]);
      } else {
        console.log('用法: npm run dev capture <模板名称>');
        console.log('示例: npm run dev capture 消息提示');
        console.log('\n执行后会进入选区模式，框选要捕获的区域');
      }
      break;

    case 'templates':
      // 列出所有模板
      showTemplates();
      break;

    case 'open-template':
      // 打开模板查看
      if (args[1]) {
        openTemplate(args[1]);
      } else {
        console.log('用法: npm run dev open-template <模板名称>');
        showTemplates();
      }
      break;

    case 'delete-template':
      // 删除模板
      if (args[1]) {
        deleteTemplate(args[1]);
      } else {
        console.log('用法: npm run dev delete-template <模板名称>');
        showTemplates();
      }
      break;

    case 'find':
      // 查找模板在屏幕上的位置
      if (args[1]) {
        console.log(`查找模板: ${args[1]}...`);
        const result = findTemplate(args[1], 0.8);
        if (result) {
          console.log(`✅ 找到: (${result.x}, ${result.y}) 置信度: ${result.confidence.toFixed(3)}`);
        } else {
          console.log('❌ 未找到');
        }
      } else {
        console.log('用法: npm run dev find <模板名称>');
      }
      break;

    // ============ 回复规则管理 ============
    case 'rules':
      // 列出所有规则
      const rules = listRules();
      console.log(`\n📋 回复规则 (共 ${rules.length} 条):\n`);
      rules.forEach((r, i) => {
        const status = r.enabled ? '✅' : '❌';
        console.log(`  ${i + 1}. ${status} ${r.name}`);
        console.log(`     关键词: ${r.keywords.join(', ')}`);
        console.log(`     回复: ${r.reply.substring(0, 40)}${r.reply.length > 40 ? '...' : ''}`);
        console.log(`     优先级: ${r.priority}`);
        console.log('');
      });
      console.log(`📁 配置文件: ${CONFIG_PATH}`);
      break;

    case 'rule-add':
      // 添加规则
      if (args[1] && args[2]) {
        const keywords = args[1].split(',');
        const reply = args.slice(2).join(' ');
        const newRule: ReplyRule = {
          id: `rule-${Date.now()}`,
          name: keywords[0],
          keywords,
          reply,
          priority: 10,
          enabled: true
        };
        addRule(newRule);
        console.log(`✅ 已添加规则: ${newRule.name}`);
      } else {
        console.log('用法: npm run dev rule-add "关键词1,关键词2" "回复内容"');
        console.log('示例: npm run dev rule-add "价格,多少钱" "亲，价格是99元哦"');
      }
      break;

    case 'rule-del':
      // 删除规则
      if (args[1]) {
        const ok = deleteRule(args[1]);
        console.log(ok ? `✅ 已删除规则: ${args[1]}` : `❌ 未找到规则: ${args[1]}`);
      } else {
        console.log('用法: npm run dev rule-del <规则ID>');
        console.log('查看规则ID: npm run dev rules');
      }
      break;

    case 'rule-toggle':
      // 启用/禁用规则
      if (args[1] && args[2]) {
        const enabled = args[2] === 'on';
        const ok = toggleRule(args[1], enabled);
        console.log(ok ? `✅ 规则 ${args[1]} 已${enabled ? '启用' : '禁用'}` : `❌ 未找到规则: ${args[1]}`);
      } else {
        console.log('用法: npm run dev rule-toggle <规则ID> <on|off>');
        console.log('示例: npm run dev rule-toggle greeting-hi off');
      }
      break;

    case 'rule-test':
      // 测试规则匹配
      if (args[1]) {
        const testMsg = args.slice(1).join(' ');
        const reply = generateReply('test-buyer', testMsg);
        console.log(`\n📝 测试消息: "${testMsg}"`);
        console.log(`🤖 匹配回复: "${reply}"`);
      } else {
        console.log('用法: npm run dev rule-test "测试消息内容"');
        console.log('示例: npm run dev rule-test "你好，在吗"');
      }
      break;

    case 'reply-on':
      // 启用自动回复
      autoReplyEnabled = true;
      console.log('✅ 自动回复已启用');
      break;

    case 'reply-off':
      // 禁用自动回复
      autoReplyEnabled = false;
      console.log('❌ 自动回复已禁用');
      break;

    default:
      console.log('用法:');
      console.log('  npm run dev monitor       - 监听新消息（带自动回复）');
      console.log('  npm run dev patrol        - 巡店模式');
      console.log('  npm run dev read          - 读取当前消息');
      console.log('  npm run dev send "hi"     - 发送消息');
      console.log('  npm run dev windows       - 列出窗口');
      console.log('  npm run dev buyers        - 列出买家');
      console.log('');
      console.log('  调试:');
      console.log('  npm run dev snapshot       - 截取聊天区域并打开');
      console.log('  npm run dev ocr-test       - 测试OCR识别');
      console.log('  npm run dev calibrate     - 交互式坐标标定');
      console.log('');
      console.log('  回复规则管理:');
      console.log('  npm run dev rules         - 列出所有规则');
      console.log('  npm run dev rule-add "关键词1,关键词2" "回复内容" - 添加规则');
      console.log('  npm run dev rule-del <ID> - 删除规则');
      console.log('  npm run dev rule-toggle <ID> <on|off> - 启用/禁用规则');
      console.log('  npm run dev rule-test "测试消息" - 测试规则匹配');
      console.log('  npm run dev reply-on      - 启用自动回复');
      console.log('  npm run dev reply-off     - 禁用自动回复');
      console.log('');
      console.log('  模板功能:');
      console.log('  npm run dev capture <名称> - 选区截图保存模板');
      console.log('  npm run dev templates     - 列出所有模板');
      console.log('  npm run dev open-template <名称> - 打开模板');
      console.log('  npm run dev delete-template <名称> - 删除模板');
      console.log('  npm run dev find <名称>   - 查找模板在屏幕上的位置');
      console.log('');
      console.log('  坐标录制:');
      console.log('  npm run dev record        - 录制点击坐标');
      console.log('  npm run dev replay <name> - 回放录制点');
      console.log('  npm run dev points        - 列出录制点');
      console.log('  npm run dev test-points   - 测试所有录制点');
  }
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n👋 退出');
  isRunning = false;
  process.exit(0);
});

main().catch(console.error);

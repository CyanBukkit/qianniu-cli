"use strict";
/**
 * 方法一：AXUIElement API（混合方案）
 *
 * 核心发现（2026-03-28 实测）：
 *   1. 千牛工作台窗口名: "t_1487330154436_074-千牛工作台"
 *   2. 点击"接待中心"按钮 → 打开独立窗口 "t_1487330154436_074-接待中心"
 *   3. 接待中心窗口结构：
 *      - 左侧导航: AXButton (消息/进店/工单/离线消息)
 *      - AXGroup @ (64,323) 240x530: 买家伙表容器
 *      - 每个买家: AXGroup，name=买家账号 (xuanyicomrade/cyanbukkit)
 *      - 买家昵称和聊天内容: AX 无法读取，必须用 OCR
 *
 * 方案：
 *   AX API → 打开接待中心 + 读买家账号列表 + 获取点击坐标
 *   OCR     → 读买家昵称 + 读聊天消息
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.detect = detect;
exports.monitor = monitor;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// 沙盒兼容的临时目录（tesseract 无法读 /tmp）
const TMP_DIR = '/Users/liuyuxuanyi/.qclaw/workspace/tmp';
// ============ 截图 + OCR（沙盒安全路径）============
function screenshotAndOCR(x, y, w, h) {
    if (w <= 0 || h <= 0)
        return '';
    const tmp = path.join(TMP_DIR, `qianniu-ocr-${Date.now()}.png`);
    try {
        (0, child_process_1.execSync)(`screencapture -R ${x},${y},${w},${h} "${tmp}"`, { timeout: 5000 });
        const text = (0, child_process_1.execSync)(`tesseract "${tmp}" stdout -l chi_sim+eng --psm 6 2>/dev/null`, {
            timeout: 20000, encoding: 'utf8'
        }).trim();
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
        return text;
    }
    catch {
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
        return '';
    }
}
// ============ AppleScript: 打开接待中心 + 获取买家列表 ============
/**
 * 完整流程：
 * 1. 找接待中心按钮并点击
 * 2. 等待窗口打开
 * 3. 遍历接待中心窗口的买家伙表
 * 返回: WIN|窗口1,窗口2,...|BUYER|账号@坐标;...
 */
const AX_MAIN_SCRIPT = `
tell application "System Events"
  tell process "Aliworkbench"
    set out to ""
    set winNames to ""
    
    -- 获取当前所有窗口名
    repeat with wIdx from 1 to (count of windows)
      set wName to name of window (wIdx)
      if winNames is "" then
        set winNames to wName
      else
        set winNames to winNames & "," & wName
      end if
    end repeat
    
    -- 找"接待中心"按钮并点击
    repeat with wIdx from 1 to (count of windows)
      set wName to name of window (wIdx)
      if wName contains "千牛工作台" then
        repeat with i from 1 to (count of UI elements of window (wIdx))
          set elem to item i of UI elements of window (wIdx)
          try
            set er to role of elem as string
            set en to name of elem as string
            if er is "AXButton" and en is "接待中心" then
              perform action "AXPress" of elem
              set out to out & "BTN_CLICKED|"
            end if
          end try
        end repeat
        exit repeat
      end if
    end repeat
    
    -- 等待窗口出现（最多等2秒）
    delay 0.8
    
    -- 重新获取窗口列表
    set newWinNames to ""
    repeat with wIdx from 1 to (count of windows)
      set wName to name of window (wIdx)
      if newWinNames is "" then
        set newWinNames to wName
      else
        set newWinNames to newWinNames & "," & wName
      end if
    end repeat
    
    -- 找接待中心窗口的买家伙表（该窗口名字包含"接待中心"）
    set buyerList to ""
    repeat with wIdx from 1 to (count of windows)
      set wName to name of window (wIdx)
      -- 接待中心窗口特征：名字以 "接待中心" 结尾
      if wName ends with "接待中心" then
        -- 找 AXGroup @ (64,323) 的买家伙表
        repeat with i from 1 to (count of UI elements of window (wIdx))
          set elem1 to UI element i of window (wIdx)
          try
            set ep1 to position of elem1
            set es1 to size of elem1
            if (item 1 of ep1) is 64 and (item 2 of ep1) is 323 then
              -- 这是买家伙表容器，获取每个买家 AXGroup
              repeat with j from 1 to (count of UI elements of elem1)
                set buyerGrp to UI element j of elem1
                try
                  set er2 to role of buyerGrp as string
                  set en2 to name of buyerGrp as string
                  set ev2 to value of buyerGrp as string
                  set ep2 to position of buyerGrp
                  set es2 to size of buyerGrp
                  
                  -- 获取买家名称：优先用 name，其次用 inner group 的 name
                  set buyerName to en2
                  if buyerName is missing value then
                    set buyerName to ev2
                  end if
                  -- 如果还是 missing value，尝试读内层 AXGroup
                  if buyerName is missing value then
                    try
                      repeat with k from 1 to (count of UI elements of buyerGrp)
                        set innerGrp to UI element k of buyerGrp
                        try
                          set innerName to name of innerGrp as string
                          if innerName is not missing value and length of innerName > 1 then
                            set buyerName to innerName
                            exit repeat
                          end if
                        end try
                      end repeat
                    end try
                  end if
                  
                  if er2 is "AXGroup" and buyerName is not missing value then
                    set buyerList to buyerList & buyerName & "@" & (item 1 of ep2) & "," & (item 2 of ep2) & "," & (item 1 of es2) & "," & (item 2 of es2) & ";"
                  end if
                end try
              end repeat
            end if
          end try
        end repeat
        exit repeat
      end if
    end repeat
    
    return "WINS|" & newWinNames & "|BUYERS|" & buyerList
  end tell
end tell
`;
// ============ AppleScript: 点击买家并读取聊天消息 ============
function clickBuyerAndReadChat(buyerX, buyerY) {
    const script = `
    tell application "System Events"
      tell process "Aliworkbench"
        -- 关闭接待中心，打开与该买家的聊天窗口
        -- 点击买家伙表中的项
        set clickResult to "CLICKED|"
        
        -- 找到接待中心窗口并点击买家
        repeat with wIdx from 1 to (count of windows)
          set wName to name of window (wIdx)
          if wName contains "接待中心" then
            perform action "AXPress" of UI element (${buyerX} + 100, ${buyerY} + 10) of window (wIdx)
          end if
        end repeat
        
        delay 1.0
        
        -- 获取聊天消息（从聊天窗口）
        set chatData to ""
        repeat with wIdx from 1 to (count of windows)
          set wName to name of window (wIdx)
          if wName does not contain "千牛工作台" and wName does not contain "接待中心" then
            -- 这可能是聊天窗口
            repeat with i from 1 to (count of UI elements of window (wIdx))
              set elem to UI element i of window (wIdx)
              try
                set er to role of elem as string
                if er is "AXTextArea" or er is "AXScrollArea" then
                  set ev to value of elem as string
                  set ep to position of elem
                  if (item 1 of ep) > 200 and length of ev > 0 then
                    set chatData to chatData & ev & "\\n---\\n"
                  end if
                end if
              end try
            end repeat
          end if
        end repeat
        
        return clickResult & chatData
      end tell
    end tell
  `;
    try {
        const tmp = `/tmp/qianniu-01-chat-click-${Date.now()}.scpt`;
        fs.writeFileSync(tmp, script, 'utf8');
        const result = (0, child_process_1.execSync)(`osascript ${tmp}`, { timeout: 10000, encoding: 'utf8' }).trim();
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
        return result;
    }
    catch {
        return '';
    }
}
// ============ 解析买家列表 ============
function parseBuyerList(rawOutput) {
    const windows = [];
    const buyers = [];
    // 解析窗口列表: WINS|窗口1,窗口2,窗口3|BUYERS|...
    const winsMatch = rawOutput.match(/WINS\|([^|]+)/);
    if (winsMatch) {
        const winNames = winsMatch[1].split(',');
        for (const n of winNames) {
            if (n.trim())
                windows.push(n.trim());
        }
    }
    // 解析买家伙表: BUYERS|账号@x,y,w,h;...
    const buyersMatch = rawOutput.match(/BUYERS\|(.+)/s);
    if (!buyersMatch)
        return { windows, buyers };
    const buyerStr = buyersMatch[1];
    const entries = buyerStr.split(';').filter(e => e.trim());
    for (const entry of entries) {
        const atIdx = entry.lastIndexOf('@');
        if (atIdx < 0)
            continue;
        const name = entry.substring(0, atIdx).trim();
        const coords = entry.substring(atIdx + 1).split(',').map(Number);
        if (!name || isNaN(coords[0]))
            continue;
        buyers.push({
            name,
            x: coords[0],
            y: coords[1],
            w: coords[2] || 240,
            h: coords[3] || 52,
            hasNewMessage: false // 红点检测暂未实现
        });
    }
    return { windows, buyers };
}
// ============ OCR 解析买家昵称和聊天 ============
function parseOCRBuyers(ocr) {
    const results = [];
    const lines = ocr.split('\\n').filter(l => l.trim().length > 0);
    // 买家中英文账号通常在列表左侧
    for (const line of lines) {
        const clean = line.replace(/\\s+/g, '').trim();
        // 过滤纯数字账号（如 t_xxx）
        if (/^t_\d+/.test(clean))
            continue;
        // 过滤短文本（可能是标签）
        if (clean.length < 3 || clean.length > 20)
            continue;
        // 过滤含网址/特殊字符
        if (clean.includes('http') || clean.includes('www'))
            continue;
        results.push({ name: clean, nickname: clean });
    }
    return results;
}
function parseOCRMessages(ocr) {
    const messages = [];
    for (const line of ocr.split('\\n')) {
        const clean = line.trim();
        if (clean.length > 2 && !/^[\d:：.]+$/.test(clean)) {
            messages.push({
                sender: clean.includes('客服') || clean.includes('我:') || clean.includes('本店') ? 'seller' : 'buyer',
                text: clean
            });
        }
    }
    return messages;
}
// ============ 主检测函数 ============
function detect() {
    const timestamp = Date.now();
    const WIN = { x: 0, y: 53, w: 1310, h: 800 };
    // 1. 运行 AX 主脚本
    let rawOutput = '';
    try {
        const tmpFile = `/tmp/qianniu-01-${timestamp}.scpt`;
        fs.writeFileSync(tmpFile, AX_MAIN_SCRIPT, 'utf8');
        rawOutput = (0, child_process_1.execSync)(`osascript ${tmpFile}`, { timeout: 15000, encoding: 'utf8' }).trim();
        try {
            fs.unlinkSync(tmpFile);
        }
        catch { }
    }
    catch {
        rawOutput = '';
    }
    // 2. 解析窗口和买家
    const { windows, buyers: axBuyers } = parseBuyerList(rawOutput);
    // 3. 如果 AX 读到买家，用 OCR 补充昵称
    let allBuyers = axBuyers;
    if (axBuyers.length > 0) {
        const ocr = screenshotAndOCR(64, 323, 240, 530);
        const ocrBuyers = parseOCRBuyers(ocr);
        // 合并：AX提供坐标，OCR提供昵称
        for (let i = 0; i < allBuyers.length && i < ocrBuyers.length; i++) {
            allBuyers[i].nickname = ocrBuyers[i]?.nickname || allBuyers[i].name;
        }
    }
    // 4. 第一个买家 = 最新
    const newBuyer = allBuyers.length > 0 ? allBuyers[0] : null;
    // 5. 点击买家，读取聊天
    const messages = [];
    if (newBuyer) {
        // 点击买家（右侧区域，避免点到分隔线）
        try {
            (0, child_process_1.execSync)(`cliclick c:${newBuyer.x + 130},${newBuyer.y + 26}`, { timeout: 3000 });
            (0, child_process_1.execSync)('sleep 1.5', { encoding: 'utf8' });
        }
        catch { }
        // AX 读聊天区（聊天窗口的消息列表）
        const chatScript = `
      tell application "System Events"
        tell process "Aliworkbench"
          set chatData to ""
          repeat with wIdx from 1 to (count of windows)
            set wName to name of window (wIdx)
            if wName does not contain "千牛工作台" and wName does not contain "接待中心" and wName does not contain "询问" then
              repeat with i from 1 to (count of UI elements of window (wIdx))
                set elem to UI element i of window (wIdx)
                try
                  set er to role of elem as string
                  set ev to value of elem as string
                  set ep to position of elem
                  if (er is "AXTextArea" or er is "AXScrollArea") and (item 1 of ep) > 200 and length of ev > 0 then
                    set chatData to chatData & ev & "\\n---\\n"
                  end if
                end try
              end repeat
            end if
          end repeat
          return chatData
        end tell
      end tell
    `;
        let axChat = '';
        try {
            const tmp = `/tmp/qianniu-01-chatscan-${timestamp}.scpt`;
            fs.writeFileSync(tmp, chatScript, 'utf8');
            axChat = (0, child_process_1.execSync)(`osascript ${tmp}`, { timeout: 8000, encoding: 'utf8' }).trim();
            try {
                fs.unlinkSync(tmp);
            }
            catch { }
        }
        catch { }
        if (axChat && axChat.length > 10) {
            for (const block of axChat.split('\\n---\\n')) {
                if (block.trim().length > 0) {
                    const isSeller = block.includes('客服') || block.includes('本店') || block.includes('我:');
                    messages.push({ sender: isSeller ? 'seller' : 'buyer', text: block.trim() });
                }
            }
        }
        else {
            // AX 读不到，用 OCR
            // 截取聊天区（接待中心右侧区域）
            const chatOcr = screenshotAndOCR(WIN.x + 310, WIN.y + 100, WIN.w - 310, WIN.h - 120);
            messages.push(...parseOCRMessages(chatOcr));
        }
    }
    return {
        buyers: allBuyers,
        newBuyer,
        messages: messages.slice(0, 20),
        method: 'ax-ui',
        timestamp,
        windows
    };
}
// ============ 轮询 ============
let prevCount = 0;
function monitor(callback, intervalMs = 5000) {
    console.log('[AX-UI] 🔍 监听中（每', intervalMs / 1000, '秒）');
    return setInterval(() => {
        const result = detect();
        if (result.buyers.length !== prevCount) {
            console.log(`[AX-UI] [${new Date().toLocaleTimeString()}]`);
            console.log(`  🪟 窗口: ${result.windows.join(' | ')}`);
            console.log(`  👥 买家: ${result.buyers.length} 个`);
            result.buyers.forEach((b, i) => {
                console.log(`     ${i + 1}. ${b.nickname || b.name} @(${b.x},${b.y})`);
            });
            prevCount = result.buyers.length;
        }
        callback(result);
    }, intervalMs);
}
// ============ CLI ============
if (require.main === module) {
    console.log('=== 方法一：AXUIElement API ===\n');
    const result = detect();
    console.log(`时间: ${new Date(result.timestamp).toLocaleString()}`);
    console.log(`窗口: ${result.windows.join(' | ')}`);
    console.log(`买家: ${result.buyers.length} 个\n`);
    result.buyers.forEach((b, i) => {
        console.log(`  ${i + 1}. ${b.nickname || b.name} (账号: ${b.name})`);
        console.log(`     位置: (${b.x}, ${b.y})`);
    });
    if (result.messages.length > 0) {
        console.log('\n💬 最新聊天:');
        result.messages.slice(-5).forEach(m => {
            const tag = m.sender === 'buyer' ? '买家' : '客服';
            console.log(`  [${tag}] ${m.text.slice(0, 70)}`);
        });
    }
    console.log('');
}

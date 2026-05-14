/**
 * 千牛自动化核心
 * 1. 读取消息（截图+OCR）
 * 2. 监听新消息（定时轮询）
 * 3. 自动回复（发送文本）
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import { screenshot, recognizeText } from './clipboard';
import {
  listWindows,
  clickAt,
  replayPoint,
  listPoints,
  interactiveRecord,
  testAll,
} from './recorder';
import {
  captureRegion,
  showTemplates,
  deleteTemplate,
  openTemplate,
  findTemplate,
} from './template';
import {
  generateReply,
  listRules,
  addRule,
  deleteRule,
  toggleRule,
  CONFIG_PATH,
  ReplyRule,
} from './reply';
import { monitorCycle, patrolCycle, setAutoReplyEnabled, getAutoReplyEnabled, stopMonitor } from './runtime/monitor';
import { readMessages, openChat, scanBuyerList } from './runtime/read';
import { sendReply } from './runtime/send';
import { loadCalibrateConfig, loadRecordedPoint, RECEPTION, runScript } from './runtime/window';
import { listPendingReplies, updatePendingReply } from './session';
import { startTui } from './tui';

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'tui';

  switch (cmd) {
    case 'monitor':
      await monitorCycle(5000);
      break;

    case 'tui':
      await startTui(5000);
      break;

    case 'patrol':
      await patrolCycle();
      break;

    case 'read': {
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
    }

    case 'snapshot': {
      console.log('截取聊天区域...');

      const snapCalibrate = loadCalibrateConfig();
      let snapX: number;
      let snapY: number;
      let snapW = 496;
      let snapH = 381;

      if (snapCalibrate) {
        snapX = snapCalibrate.x;
        snapY = snapCalibrate.y;
        snapW = snapCalibrate.w;
        snapH = snapCalibrate.h;
        console.log(`📍 使用标定坐标: (${snapX}, ${snapY}) ${snapW}x${snapH}`);
      } else {
        snapX = RECEPTION.x + 260;
        snapY = RECEPTION.y + 50;
        console.log(`📍 使用默认坐标: (${snapX}, ${snapY})`);
      }

      const snapPath = `/tmp/qianniu-debug-${Date.now()}.png`;
      screenshot(snapX, snapY, snapW, snapH, snapPath);

      if (!fs.existsSync(snapPath)) {
        console.error('❌ 截图失败！请检查千牛窗口是否已打开');
        break;
      }

      console.log(`✅ 已保存到: ${snapPath}`);
      execSync(`open ${snapPath}`);
      break;
    }

    case 'ocr-test': {
      console.log('截取并识别...\n');

      const debugPath = '/tmp/qianniu-ocr-debug.png';
      let testX: number;
      let testY: number;
      let testW = 900;
      let testH = 500;

      const calibrate = loadCalibrateConfig();
      if (calibrate) {
        testX = calibrate.x;
        testY = calibrate.y;
        testW = calibrate.w;
        testH = calibrate.h;
        console.log(`📍 使用标定坐标: (${testX}, ${testY}) ${testW}x${testH}`);
      } else {
        testX = RECEPTION.x + 260;
        testY = RECEPTION.y + 50;
        console.log(`📍 使用默认坐标: (${testX}, ${testY})`);
      }

      screenshot(testX, testY, testW, testH, debugPath);

      if (!fs.existsSync(debugPath)) {
        console.error('❌ 截图失败！请检查：');
        console.error('  1. 千牛窗口是否已打开');
        console.error('  2. 坐标是否正确 (可能超出屏幕范围)');
        console.error('  3. 尝试运行: npm run dev calibrate 重新标定坐标');
        break;
      }

      console.log(`📸 截图已保存: ${debugPath}`);
      const msgs = await recognizeText(debugPath);
      console.log('OCR 识别结果:');
      console.log(msgs.length ? msgs : '(无内容)');

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

    case 'pending': {
      const pendingReplies = listPendingReplies();
      if (pendingReplies.length === 0) {
        console.log('当前没有挂起回复');
        break;
      }

      console.log(`当前有 ${pendingReplies.length} 条挂起回复:`);
      pendingReplies.forEach(reply => {
        console.log(`\n[${reply.id}] ${reply.createdAt}`);
        console.log(`  买家: ${reply.buyerName}`);
        console.log(`  状态: ${reply.status}`);
        console.log(`  备注: ${reply.note || '(无)'}`);
        console.log(`  原会话: ${reply.requestedFingerprint.buyerName} / ${reply.requestedFingerprint.tailSignature}`);
        console.log(`  当前会话: ${reply.currentFingerprint.buyerName} / ${reply.currentFingerprint.tailSignature}`);
        console.log(`  原因: ${reply.reason}`);
        console.log(`  草稿: ${reply.draft}`);
      });
      break;
    }

    case 'pending-update': {
      const id = args[1];
      const status = args[2] as 'pending' | 'reviewing' | 'resolved' | 'ignored' | undefined;
      const note = args.slice(3).join(' ').trim();

      if (!id || !status) {
        console.log('用法: npm run dev pending-update <id> <pending|reviewing|resolved|ignored> [备注]');
        break;
      }

      const updated = updatePendingReply(id, {
        status,
        note: note || undefined,
      });

      if (!updated) {
        console.log(`未找到挂起回复: ${id}`);
        break;
      }

      console.log(`已更新 ${updated.id}`);
      console.log(`  状态: ${updated.status}`);
      console.log(`  备注: ${updated.note || '(无)'}`);
      break;
    }

    case 'calibrate': {
      console.log('=== 智能坐标标定 ===');
      console.log('请按步骤操作，程序会自动计算聊天区域位置\n');

      const newConsultPoint = loadRecordedPoint('新的客户咨询');
      if (newConsultPoint) {
        clickAt(newConsultPoint.x, newConsultPoint.y);
        execSync('sleep 0.5');
      }

      console.log('📋 步骤1: 获取千牛接待中心窗口位置...');
      const getWindowPos = () => {
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

      console.log('\n📋 步骤2: 请框选聊天消息区域');
      console.log('  → 现在请用鼠标框选聊天消息区域（不要框选输入框）');
      console.log('  → 框选后程序会自动计算相对位置\n');
      execSync('sleep 1');

      const chatPath = '/tmp/qianniu-calibrate-chat.png';
      try {
        execSync(`screencapture -i -x "${chatPath}"`, { timeout: 30000 });
      } catch {
        console.log('❌ 取消框选');
        break;
      }

      console.log('\n📋 步骤3: 请点击聊天区域的四个角（按回车确认每一步）');
      console.log('  1. 左上角 → 回车');
      console.log('  2. 右下角 → 回车\n');

      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (prompt: string): Promise<void> => new Promise(resolve => rl.question(prompt, () => resolve()));
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

      const chatW = br[0] - tl[0];
      const chatH = br[1] - tl[1];
      const offsetX = tl[0] - winPos.x;
      const offsetY = tl[1] - winPos.y;

      console.log('\n=== 标定完成 ===');
      console.log(`窗口位置: (${winPos.x}, ${winPos.y})`);
      console.log(`聊天区域偏移: (${offsetX}, ${offsetY})`);
      console.log(`聊天区域大小: ${chatW}x${chatH}\n`);

      const configPath = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/calibrate.json';
      const config = {
        windowX: winPos.x,
        windowY: winPos.y,
        offsetX,
        offsetY,
        chatW,
        chatH,
        calibratedAt: new Date().toISOString(),
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`✅ 已保存到: ${configPath}`);
      console.log('\n现在可以运行 npm run dev ocr-test 测试识别效果');
      break;
    }

    case 'record':
      interactiveRecord();
      break;

    case 'replay':
      if (args[1]) {
        replayPoint(args[1]);
      } else {
        console.log('用法: npm run dev replay <点名称>');
        listPoints();
      }
      break;

    case 'points':
      listPoints();
      break;

    case 'test-points':
      testAll();
      break;

    case 'capture':
      if (args[1]) {
        captureRegion(args[1]);
      } else {
        console.log('用法: npm run dev capture <模板名称>');
        console.log('示例: npm run dev capture 消息提示');
        console.log('\n执行后会进入选区模式，框选要捕获的区域');
      }
      break;

    case 'templates':
      showTemplates();
      break;

    case 'open-template':
      if (args[1]) {
        openTemplate(args[1]);
      } else {
        console.log('用法: npm run dev open-template <模板名称>');
        showTemplates();
      }
      break;

    case 'delete-template':
      if (args[1]) {
        deleteTemplate(args[1]);
      } else {
        console.log('用法: npm run dev delete-template <模板名称>');
        showTemplates();
      }
      break;

    case 'find':
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

    case 'rules': {
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
    }

    case 'rule-add':
      if (args[1] && args[2]) {
        const keywords = args[1].split(',');
        const reply = args.slice(2).join(' ');
        const newRule: ReplyRule = {
          id: `rule-${Date.now()}`,
          name: keywords[0],
          keywords,
          reply,
          priority: 10,
          enabled: true,
        };
        addRule(newRule);
        console.log(`✅ 已添加规则: ${newRule.name}`);
      } else {
        console.log('用法: npm run dev rule-add "关键词1,关键词2" "回复内容"');
        console.log('示例: npm run dev rule-add "价格,多少钱" "亲，价格是99元哦"');
      }
      break;

    case 'rule-del':
      if (args[1]) {
        const ok = deleteRule(args[1]);
        console.log(ok ? `✅ 已删除规则: ${args[1]}` : `❌ 未找到规则: ${args[1]}`);
      } else {
        console.log('用法: npm run dev rule-del <规则ID>');
        console.log('查看规则ID: npm run dev rules');
      }
      break;

    case 'rule-toggle':
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
      setAutoReplyEnabled(true);
      console.log('✅ 自动回复已启用');
      break;

    case 'reply-off':
      setAutoReplyEnabled(false);
      console.log('❌ 自动回复已禁用');
      break;

    default:
      console.log('用法:');
      console.log('  npm run dev monitor       - 监听新消息（带自动回复）');
      console.log('  npm run dev tui           - 终端面板模式（实时状态 + 监听）');
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
      console.log('  坐标录制（支持三种模式）:');
      console.log('  npm run dev record        - 录制点击坐标（默认比例模式）');
      console.log('  npm run dev replay <name> - 回放录制点');
      console.log('  npm run dev points        - 列出录制点');
      console.log('  npm run dev test-points   - 测试所有录制点');
      console.log('');
      console.log('  录制模式说明:');
      console.log('  输入名称              - 比例模式 (ratio)，相对于窗口的比例');
      console.log('  名称@fixed           - 固定坐标模式，屏幕绝对坐标');
      console.log('  名称@offset          - 窗口偏移模式，相对于窗口的像素偏移');
  }
}

process.on('SIGINT', () => {
  console.log('\n\n👋 退出');
  stopMonitor();
  process.exit(0);
});

main().catch(console.error);

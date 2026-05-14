import { execSync } from 'child_process';
import { clickAt } from '../recorder';
import { ALIWORKBENCH, activateApp, loadCalibrateConfig, loadRecordedPoint, runScript } from './window';

export function sendTextViaClipboard(text: string): void {
  console.log(`  📋 准备发送: "${text.substring(0, 30)}..."`);

  const escapedText = text.replace(/"/g, '\\"').replace(/'/g, "\\'");
  execSync(`printf '%s' "${escapedText}" | pbcopy`, { encoding: 'utf8' });
  execSync('sleep 0.1');

  const clipboardContent = execSync('pbpaste', { encoding: 'utf8' }).trim();
  console.log(`  📋 剪贴板内容: "${clipboardContent.substring(0, 20)}..."`);

  execSync('sleep 0.1');
  runScript(`tell application "System Events" to keystroke "v" using command down`);
  execSync('sleep 0.2');
  runScript(`tell application "System Events" to keystroke return`);
  console.log('  📤 已回车发送');
}

export function sendReply(text: string): boolean {
  try {
    console.log('📤 开始发送回复...');
    activateApp(ALIWORKBENCH);
    execSync('sleep 0.3');

    console.log('  → 点击聊天区域');
    const chatAreaPoint = loadRecordedPoint('聊天区域');
    if (chatAreaPoint) {
      console.log(`  → 点击聊天输入框: (${chatAreaPoint.x}, ${chatAreaPoint.y})`);
      clickAt(chatAreaPoint.x, chatAreaPoint.y);
      execSync('sleep 0.5');
      activateApp(ALIWORKBENCH);
      execSync('sleep 0.2');
    } else {
      console.log('  ⚠️ 未找到"聊天记录"坐标，尝试使用标定配置');
      const calibrate = loadCalibrateConfig();
      if (calibrate) {
        const inputX = calibrate.x + calibrate.w / 2;
        const inputY = calibrate.y + calibrate.h - 30;
        console.log(`  → 使用备选坐标: (${inputX}, ${inputY})`);
        clickAt(inputX, inputY);
        execSync('sleep 0.5');
      }
    }

    console.log('  → 粘贴并发送');
    sendTextViaClipboard(text);
    console.log('  ✅ 发送完成');
    return true;
  } catch (e) {
    console.error('发送失败:', e);
    return false;
  }
}

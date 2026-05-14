import { execSync } from 'child_process';
import { askAIAsync } from '../ai-client';
import { clickAt } from '../recorder';
import { loadConfig } from '../reply';
import { readMessages, openChat, scanBuyerList } from './read';
import { sendReply } from './send';
import { closePopups, loadRecordedPoint } from './window';

let isRunning = false;
let autoReplyEnabled = true;

export function setAutoReplyEnabled(enabled: boolean): void {
  autoReplyEnabled = enabled;
}

export function getAutoReplyEnabled(): boolean {
  return autoReplyEnabled;
}

export function stopMonitor(): void {
  isRunning = false;
}

export async function monitorCycle(intervalMs = 5000): Promise<void> {
  isRunning = true;

  console.log(`\n⏳ 监听中，每 ${intervalMs / 1000}s 检查一次...`);
  console.log(`🤖 自动回复: ${autoReplyEnabled ? '已启用' : '已禁用'}`);
  console.log('按 Ctrl+C 停止\n');

  const replyConfig = loadConfig();
  console.log(`📋 已加载 ${replyConfig.rules.filter(r => r.enabled).length} 条生效规则\n`);

  while (isRunning) {
    try {
      const newConsultPoint = loadRecordedPoint('新的客户咨询');
      if (newConsultPoint) {
        clickAt(newConsultPoint.x, newConsultPoint.y);
        execSync('sleep 1.5');
        console.log('📋 已点击"新的客户咨询"通知，等待跳转...');

        const hadPopup = await closePopups();
        if (hadPopup) {
          console.log('🔔 已关闭弹窗');
          execSync('sleep 0.3');
        }

        if (autoReplyEnabled) {
          const quickReplies = [
            '香果正在敲键盘',
            '香果正在深度思考中',
            '收到你的消息了香果正在思考',
            '香果在正在思考中',
            '香果正在回复您的消息稍等几秒钟',
            '⭕️ 香果回应加载中... ',
            '⭕️ 思考中...',
            '👩‍💻 香果正在敲键盘',
          ];
          const quickReply = quickReplies[Math.floor(Math.random() * quickReplies.length)];
          console.log(`📤 发送快捷回复: ${quickReply}`);
          const ok = sendReply(quickReply);
          console.log(ok ? '✅ 已发送' : '❌ 发送失败');
        }

        console.log('🔍 拦截买家消息...');
        try {
          const messages = await readMessages();
          if (messages.length > 0) {
            console.log(`  📋 读取到 ${messages.length} 条消息`);
            const buyerMessage = messages.join('\n');
            console.log('  📤 发送给 AI 分析...');

            askAIAsync(
              { messages: [{ role: 'user', content: `以下是客户与卖家之前的聊天记录，卖家的名是CyanBukkit网站，请回复时保持500字以内：\n${buyerMessage}` }] },
              (response) => {
                if (response.content) {
                  console.log(`  🤖 AI 回复: ${response.content.substring(0, 50)}...`);
                  const ok = sendReply(response.content);
                  console.log(ok ? '  ✅ AI 回复已发送' : '  ❌ AI 回复发送失败');
                } else {
                  console.log('  ⚠️ AI 未返回有效内容');
                }
              }
            );
          }
        } catch (e) {
          console.log('  ⚠️ 读取失败:', e);
        }

        console.log('⏭️ 进入下一轮轮询...');
      } else {
        console.log(`📋 [${new Date().toLocaleString()}] 无新咨询消息，跳过...`);
      }
    } catch (e) {
      console.error('处理失败:', e);
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }
}

export async function patrolCycle(): Promise<void> {
  console.log('🔍 开始巡店...\n');

  const newConsultPoint = loadRecordedPoint('新的客户咨询');
  if (newConsultPoint) {
    clickAt(newConsultPoint.x, newConsultPoint.y);
    execSync('sleep 1');
  }

  const buyers = scanBuyerList();
  console.log(`发现 ${buyers.length} 个接待中:`, buyers.map(b => b.name).join(', '));

  for (const buyer of buyers) {
    console.log(`\n👉 进入 ${buyer.name}...`);
    openChat(buyer);

    const messages = await readMessages();
    console.log(`  消息 (${messages.length} 条):`);
    messages.slice(-4).forEach(m => console.log(`    ${m}`));

    if (messages.length > 0) {
      console.log(`  最新: ${messages[messages.length - 1]}`);
    }
  }

  console.log('\n✅ 巡店完成');
}

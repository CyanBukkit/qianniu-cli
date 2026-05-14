import { execSync } from 'child_process';
import { askAIAsync } from '../ai-client';
import { clickAt } from '../recorder';
import { loadConfig } from '../reply';
import { readMessages, readParsedChat, openChat, scanBuyerList } from './read';
import { sendReply } from './send';
import { closePopups, loadRecordedPoint } from './window';
import {
  AI_SENDER_PREFIX,
  SELLER_NAME,
  extractRecentBuyerMessages,
  formatMessagesForPrompt,
  listPendingReplies,
  savePendingReply,
} from '../session';
import { ChatFingerprint } from '../types';
import {
  appendRuntimeLog,
  clearRuntimeError,
  markRuntimePoll,
  setRuntimeAutoReply,
  setRuntimeBuyers,
  setRuntimeError,
  setRuntimePendingReplyCount,
  setRuntimePhase,
  setRuntimeRunning,
  updateRuntimeSession,
} from './state';

let isRunning = false;
let autoReplyEnabled = true;
let pendingReplyCounter = 0;
let monitorLoopCount = 0;

function playPendingReplyAlert(): void {
  try {
    execSync('afplay /System/Library/Sounds/Glass.aiff', { timeout: 2000 });
  } catch {
    // 忽略提示音失败
  }
}

function canAutoSendReply(expected: ChatFingerprint, current: ChatFingerprint): boolean {
  return expected.buyerName === current.buyerName && expected.tailSignature === current.tailSignature;
}

function createPendingReplyId(): string {
  pendingReplyCounter += 1;
  return `pending_${Date.now()}_${pendingReplyCounter}`;
}

export function setAutoReplyEnabled(enabled: boolean): void {
  autoReplyEnabled = enabled;
  setRuntimeAutoReply(enabled);
  setRuntimePhase(enabled ? 'idle' : 'paused');
}

export function getAutoReplyEnabled(): boolean {
  return autoReplyEnabled;
}

export function stopMonitor(): void {
  isRunning = false;
  setRuntimeRunning(false, 'stopped');
}

export async function monitorCycle(intervalMs = 5000): Promise<void> {
  isRunning = true;
  monitorLoopCount = 0;
  setRuntimeRunning(true, 'booting');
  setRuntimeAutoReply(autoReplyEnabled);
  setRuntimePendingReplyCount(listPendingReplies().filter(reply => reply.status !== 'resolved' && reply.status !== 'ignored').length);
  appendRuntimeLog(`监听启动，间隔 ${intervalMs}ms`);

  console.log(`\n⏳ 监听中，每 ${intervalMs / 1000}s 检查一次...`);
  console.log(`🤖 任务状态: ${autoReplyEnabled ? '运行中' : '已暂停'}`);
  console.log('按 Ctrl+C 停止\n');

  const replyConfig = loadConfig();
  console.log(`📋 已加载 ${replyConfig.rules.filter(r => r.enabled).length} 条生效规则\n`);

  while (isRunning) {
    monitorLoopCount += 1;
    markRuntimePoll(monitorLoopCount, intervalMs);
    try {
      clearRuntimeError();

      if (!autoReplyEnabled) {
        setRuntimePhase('paused');
        updateRuntimeSession({
          status: 'paused',
        });
        appendRuntimeLog('任务已暂停，跳过本轮监听');
        await new Promise(r => setTimeout(r, intervalMs));
        continue;
      }

      setRuntimePhase('查找新咨询');
      const newConsultPoint = loadRecordedPoint('新的客户咨询');
      if (newConsultPoint) {
        clickAt(newConsultPoint.x, newConsultPoint.y);
        execSync('sleep 1.5');
        appendRuntimeLog('已点击新的客户咨询');
        console.log('📋 已点击"新的客户咨询"通知，等待跳转...');

        setRuntimePhase('关闭弹窗');
        const hadPopup = await closePopups();
        if (hadPopup) {
          appendRuntimeLog('已关闭消息弹窗');
          console.log('🔔 已关闭弹窗');
          execSync('sleep 0.3');
        }

        if (autoReplyEnabled) {
          setRuntimePhase('发送快捷回复');
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
          updateRuntimeSession({
            status: 'sending-quick-reply',
            lastAIReply: quickReply,
          });
          console.log(`📤 发送快捷回复: ${quickReply}`);
          const ok = sendReply(quickReply);
          appendRuntimeLog(ok ? '快捷回复发送成功' : '快捷回复发送失败', ok ? 'info' : 'warn');
          console.log(ok ? '✅ 已发送' : '❌ 发送失败');
        }

        console.log('🔍 拦截买家消息...');
        try {
          setRuntimePhase('读取聊天');
          const { transcript, parsedMessages, fingerprint } = await readParsedChat();
          if (parsedMessages.length > 0) {
            const buyers = scanBuyerList();
            setRuntimeBuyers(buyers);
            console.log(`  📋 解析到 ${parsedMessages.length} 条消息`);
            console.log(`  👤 当前买家: ${fingerprint.buyerName}`);
            console.log(`  🧬 会话签名: ${fingerprint.tailSignature}`);
            const recentBuyerMessages = extractRecentBuyerMessages(parsedMessages, 3);
            updateRuntimeSession({
              buyerName: fingerprint.buyerName,
              tailSignature: fingerprint.tailSignature,
              lastMessageAt: fingerprint.lastMessageAt,
              parsedMessageCount: parsedMessages.length,
              transcriptPreview: formatMessagesForPrompt(parsedMessages.slice(-8)),
              buyerMessagesPreview: recentBuyerMessages.map(message => formatMessagesForPrompt([message])),
              status: 'building-prompt',
            });
            const promptBody = [
              `当前店铺卖家账号名是：${SELLER_NAME}`,
              `当前买家账号名是：${fingerprint.buyerName}`,
              '以下是当前会话最近解析到的聊天记录：',
              formatMessagesForPrompt(parsedMessages.slice(-12)),
              '',
              '以下是买家最近发来的重点消息：',
              formatMessagesForPrompt(recentBuyerMessages),
            ].join('\n');
            console.log('  📤 发送给 AI 分析...');
            setRuntimePhase('等待 AI');
            appendRuntimeLog(`发送 AI 请求，当前买家 ${fingerprint.buyerName}`);

            askAIAsync(
              { messages: [{ role: 'user', content: `${promptBody}\n\n请你以淘宝店铺客服身份回复买家，回复控制在500字以内，不要冒充买家，不要混淆双方身份。` }] },
              async (response) => {
                if (response.content) {
                  const normalizedContent = response.content.startsWith(AI_SENDER_PREFIX)
                    ? response.content
                    : `${AI_SENDER_PREFIX} ${response.content}`;
                  updateRuntimeSession({
                    status: 'ai-replied',
                    lastAIReply: normalizedContent,
                  });
                  appendRuntimeLog(`AI 已返回草稿，买家 ${fingerprint.buyerName}`);
                  console.log(`  🤖 AI 回复: ${normalizedContent.substring(0, 50)}...`);

                  try {
                    setRuntimePhase('校验会话');
                    const latestChat = await readParsedChat();
                    if (!canAutoSendReply(fingerprint, latestChat.fingerprint)) {
                      const pendingId = createPendingReplyId();
                      savePendingReply({
                        id: pendingId,
                        createdAt: new Date().toISOString(),
                        buyerName: fingerprint.buyerName,
                        requestedFingerprint: fingerprint,
                        currentFingerprint: latestChat.fingerprint,
                        originalTranscript: transcript,
                        draft: normalizedContent,
                        reason: `AI 返回时前台会话已变化：原买家=${fingerprint.buyerName}，当前买家=${latestChat.fingerprint.buyerName}`,
                        status: 'pending',
                        note: '等待人工确认后处理',
                      });
                      setRuntimePendingReplyCount(listPendingReplies().filter(reply => reply.status !== 'resolved' && reply.status !== 'ignored').length);
                      updateRuntimeSession({
                        status: 'pending-review',
                      });
                      appendRuntimeLog(`会话已切换，回复挂起 ${pendingId}`, 'warn');
                      console.log(`  ⚠️ 会话已切换，AI 回复已挂起: ${pendingId}`);
                      console.log(`  ⚠️ 原会话 ${fingerprint.buyerName} -> 当前会话 ${latestChat.fingerprint.buyerName}`);
                      playPendingReplyAlert();
                      return;
                    }

                    setRuntimePhase('发送 AI 回复');
                    const ok = sendReply(normalizedContent);
                    updateRuntimeSession({
                      status: ok ? 'reply-sent' : 'reply-send-failed',
                    });
                    appendRuntimeLog(ok ? `AI 回复已发送给 ${fingerprint.buyerName}` : `AI 回复发送失败 ${fingerprint.buyerName}`, ok ? 'info' : 'error');
                    console.log(ok ? '  ✅ AI 回复已发送' : '  ❌ AI 回复发送失败');
                  } catch (verifyError) {
                    const pendingId = createPendingReplyId();
                    savePendingReply({
                      id: pendingId,
                      createdAt: new Date().toISOString(),
                      buyerName: fingerprint.buyerName,
                      requestedFingerprint: fingerprint,
                      currentFingerprint: fingerprint,
                      originalTranscript: transcript,
                      draft: normalizedContent,
                      reason: `AI 返回后会话校验失败: ${String(verifyError)}`,
                      status: 'pending',
                      note: '等待人工确认后处理',
                    });
                    setRuntimePendingReplyCount(listPendingReplies().filter(reply => reply.status !== 'resolved' && reply.status !== 'ignored').length);
                    setRuntimeError(String(verifyError));
                    updateRuntimeSession({
                      status: 'pending-review',
                    });
                    appendRuntimeLog(`会话校验失败，回复挂起 ${pendingId}`, 'warn');
                    console.log(`  ⚠️ 会话校验失败，AI 回复已挂起: ${pendingId}`);
                    playPendingReplyAlert();
                  }
                } else {
                  updateRuntimeSession({
                    status: 'ai-empty',
                  });
                  appendRuntimeLog('AI 未返回有效内容', 'warn');
                  console.log('  ⚠️ AI 未返回有效内容');
                }
              }
            );
          } else if (transcript.trim()) {
            const messages = await readMessages();
            updateRuntimeSession({
              status: 'parse-fallback',
              transcriptPreview: messages.slice(-8).join('\n'),
              parsedMessageCount: messages.length,
            });
            appendRuntimeLog(`结构化解析失败，退回原始模式 ${messages.length} 行`, 'warn');
            console.log(`  ⚠️ 未能结构化解析聊天，退回原始模式 (${messages.length} 行)`);
          }
        } catch (e) {
          const errorMessage = String(e);
          setRuntimeError(errorMessage);
          updateRuntimeSession({
            status: 'read-failed',
          });
          appendRuntimeLog(`读取失败: ${errorMessage}`, 'error');
          console.log('  ⚠️ 读取失败:', e);
        }

        setRuntimePhase('等待下一轮');
        console.log('⏭️ 进入下一轮轮询...');
      } else {
        setRuntimePhase('空闲等待');
        setRuntimeBuyers(scanBuyerList());
        appendRuntimeLog('本轮未发现新的客户咨询');
        console.log(`📋 [${new Date().toLocaleString()}] 无新咨询消息，跳过...`);
      }
    } catch (e) {
      const errorMessage = String(e);
      setRuntimeError(errorMessage);
      appendRuntimeLog(`处理失败: ${errorMessage}`, 'error');
      console.error('处理失败:', e);
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }

  setRuntimeRunning(false, 'stopped');
  appendRuntimeLog('监听已停止');
}

export async function patrolCycle(): Promise<void> {
  appendRuntimeLog('开始巡店');
  console.log('🔍 开始巡店...\n');

  const newConsultPoint = loadRecordedPoint('新的客户咨询');
  if (newConsultPoint) {
    clickAt(newConsultPoint.x, newConsultPoint.y);
    execSync('sleep 1');
  }

  const buyers = scanBuyerList();
  setRuntimeBuyers(buyers);
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

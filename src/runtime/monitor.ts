import { execSync } from 'child_process';
import { askAIAsync } from '../ai-client';
import { clickAt } from '../recorder';
import { loadConfig } from '../reply';
import { readMessages, readParsedChat, openChat, scanBuyerList } from './read';
import { sendReply } from './send';
import { closePopups, getQianniuWindowNames, loadRecordedPoint } from './window';
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
import { appendAuditLog } from './audit-log';

let isRunning = false;
let autoReplyEnabled = true;
let pendingReplyCounter = 0;
let monitorLoopCount = 0;
// 运行期内按会话防重，避免同一弹窗或同一 AI 回调把同一个买家刷多次。
const activeAIRequests = new Set<string>();
const handledSessionKeys = new Set<string>();
const sentQuickReplyKeys = new Set<string>();
const sentReplyKeys = new Set<string>();

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

function createSessionKey(fingerprint: ChatFingerprint): string {
  return `${fingerprint.buyerName}::${fingerprint.tailSignature}`;
}

function createReplyKey(fingerprint: ChatFingerprint, text: string, kind: 'quick' | 'ai'): string {
  return `${kind}::${createSessionKey(fingerprint)}::${text.trim()}`;
}

function hasNewConsultationWindow(): boolean {
  const windowNames = getQianniuWindowNames();
  const matchedWindows = windowNames.filter(name => name.includes('消息提醒'));
  appendAuditLog('new-consultation-check', {
    windowNames,
    matchedWindows,
    matched: matchedWindows.length > 0,
  });
  return matchedWindows.length > 0;
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
      if (hasNewConsultationWindow()) {
        appendAuditLog('new-consultation-detected', {
          loopCount: monitorLoopCount,
        });
        const newConsultPoint = loadRecordedPoint('新的客户咨询');
        if (!newConsultPoint) {
          appendRuntimeLog('检测到消息提醒窗口，但无法定位“新的客户咨询”坐标', 'warn');
          console.log('⚠️ 检测到消息提醒窗口，但无法定位“新的客户咨询”坐标');
          appendAuditLog('new-consultation-point-miss', {
            loopCount: monitorLoopCount,
          }, 'warn');
          await new Promise(r => setTimeout(r, intervalMs));
          continue;
        }

        appendAuditLog('new-consultation-click', {
          loopCount: monitorLoopCount,
          x: newConsultPoint.x,
          y: newConsultPoint.y,
        });
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

        console.log('🔍 拦截买家消息...');
        try {
          setRuntimePhase('读取聊天');
          const { transcript, parsedMessages, fingerprint } = await readParsedChat();
          if (parsedMessages.length > 0) {
            const sessionKey = createSessionKey(fingerprint);
            appendAuditLog('chat-parsed', {
              loopCount: monitorLoopCount,
              buyerName: fingerprint.buyerName,
              tailSignature: fingerprint.tailSignature,
              lastMessageAt: fingerprint.lastMessageAt,
              parsedMessageCount: parsedMessages.length,
              transcriptPreview: transcript.slice(0, 500),
            });
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

            const lastMessage = parsedMessages[parsedMessages.length - 1];
            if (lastMessage.senderRole !== 'buyer') {
              appendAuditLog('auto-reply-skip', {
                reason: 'non-buyer-tail',
                buyerName: fingerprint.buyerName,
                tailSignature: fingerprint.tailSignature,
                lastSender: lastMessage.senderName,
                lastSenderRole: lastMessage.senderRole,
                lastContent: lastMessage.content.slice(0, 120),
              });
              updateRuntimeSession({
                status: 'skip-non-buyer-tail',
              });
              appendRuntimeLog(`最新消息不是买家，跳过自动回复 ${fingerprint.buyerName}`);
              console.log('  ⏭️ 最新一条消息不是买家发送，跳过自动回复');
              continue;
            }

            if (handledSessionKeys.has(sessionKey)) {
              appendAuditLog('auto-reply-skip', {
                reason: 'duplicate-session',
                buyerName: fingerprint.buyerName,
                tailSignature: fingerprint.tailSignature,
              });
              updateRuntimeSession({
                status: 'skip-duplicate-session',
              });
              appendRuntimeLog(`相同会话已处理过，跳过 ${fingerprint.buyerName}`);
              console.log('  ⏭️ 相同会话本次运行已处理，跳过重复发送');
              continue;
            }

            if (activeAIRequests.has(sessionKey)) {
              appendAuditLog('auto-reply-skip', {
                reason: 'ai-pending',
                buyerName: fingerprint.buyerName,
                tailSignature: fingerprint.tailSignature,
              });
              updateRuntimeSession({
                status: 'skip-ai-pending',
              });
              appendRuntimeLog(`相同会话 AI 请求仍在处理中，跳过 ${fingerprint.buyerName}`);
              console.log('  ⏭️ 当前会话的 AI 请求尚未完成，跳过重复触发');
              continue;
            }

            if (autoReplyEnabled && !sentQuickReplyKeys.has(sessionKey)) {
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
              const quickReplyKey = createReplyKey(fingerprint, quickReply, 'quick');

              sentQuickReplyKeys.add(sessionKey);
              sentReplyKeys.add(quickReplyKey);
              appendAuditLog('quick-reply-send', {
                buyerName: fingerprint.buyerName,
                tailSignature: fingerprint.tailSignature,
                reply: quickReply,
              });
              updateRuntimeSession({
                status: 'sending-quick-reply',
                lastAIReply: quickReply,
              });
              console.log(`📤 发送快捷回复: ${quickReply}`);
              const ok = sendReply(quickReply);
              appendRuntimeLog(ok ? '快捷回复发送成功' : '快捷回复发送失败', ok ? 'info' : 'warn');
              console.log(ok ? '✅ 已发送' : '❌ 发送失败');
            }

            handledSessionKeys.add(sessionKey);
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
            activeAIRequests.add(sessionKey);
            appendAuditLog('ai-request-start', {
              buyerName: fingerprint.buyerName,
              tailSignature: fingerprint.tailSignature,
              promptPreview: promptBody.slice(0, 1000),
            });

            askAIAsync(
              { messages: [{ role: 'user', content: `${promptBody}\n\n请你以淘宝店铺客服身份回复买家，回复控制在500字以内，不要冒充买家，不要混淆双方身份。` }] },
              async (response) => {
                try {
                  if (response.content) {
                    const normalizedContent = response.content.startsWith(AI_SENDER_PREFIX)
                      ? response.content
                      : `${AI_SENDER_PREFIX} ${response.content}`;
                    appendAuditLog('ai-request-finish', {
                      buyerName: fingerprint.buyerName,
                      tailSignature: fingerprint.tailSignature,
                      responsePreview: normalizedContent.slice(0, 300),
                      empty: false,
                    });
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
                        appendAuditLog('ai-reply-pending', {
                          reason: 'session-changed',
                          buyerName: fingerprint.buyerName,
                          tailSignature: fingerprint.tailSignature,
                          currentBuyerName: latestChat.fingerprint.buyerName,
                          currentTailSignature: latestChat.fingerprint.tailSignature,
                        }, 'warn');
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

                      const aiReplyKey = createReplyKey(fingerprint, normalizedContent, 'ai');
                      if (sentReplyKeys.has(aiReplyKey)) {
                        appendAuditLog('auto-reply-skip', {
                          reason: 'duplicate-ai-reply',
                          buyerName: fingerprint.buyerName,
                          tailSignature: fingerprint.tailSignature,
                          replyPreview: normalizedContent.slice(0, 120),
                        }, 'warn');
                        updateRuntimeSession({
                          status: 'skip-duplicate-ai-reply',
                        });
                        appendRuntimeLog(`检测到重复 AI 回复，已跳过 ${fingerprint.buyerName}`, 'warn');
                        console.log('  ⏭️ 检测到重复 AI 回复，已跳过发送');
                        return;
                      }

                      sentReplyKeys.add(aiReplyKey);
                      appendAuditLog('ai-reply-send', {
                        buyerName: fingerprint.buyerName,
                        tailSignature: fingerprint.tailSignature,
                        replyPreview: normalizedContent.slice(0, 300),
                      });
                      setRuntimePhase('发送 AI 回复');
                      const ok = sendReply(normalizedContent);
                      updateRuntimeSession({
                        status: ok ? 'reply-sent' : 'reply-send-failed',
                      });
                      appendRuntimeLog(ok ? `AI 回复已发送给 ${fingerprint.buyerName}` : `AI 回复发送失败 ${fingerprint.buyerName}`, ok ? 'info' : 'error');
                      console.log(ok ? '  ✅ AI 回复已发送' : '  ❌ AI 回复发送失败');
                    } catch (verifyError) {
                      appendAuditLog('ai-reply-pending', {
                        reason: 'verify-failed',
                        buyerName: fingerprint.buyerName,
                        tailSignature: fingerprint.tailSignature,
                        error: String(verifyError),
                      }, 'warn');
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
                    appendAuditLog('ai-request-finish', {
                      buyerName: fingerprint.buyerName,
                      tailSignature: fingerprint.tailSignature,
                      empty: true,
                    }, 'warn');
                    updateRuntimeSession({
                      status: 'ai-empty',
                    });
                    appendRuntimeLog('AI 未返回有效内容', 'warn');
                    console.log('  ⚠️ AI 未返回有效内容');
                  }
                } finally {
                  activeAIRequests.delete(sessionKey);
                }
              }
            );
          } else if (transcript.trim()) {
            appendAuditLog('chat-parse-fallback', {
              loopCount: monitorLoopCount,
              transcriptPreview: transcript.slice(0, 500),
            }, 'warn');
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
          appendAuditLog('monitor-read-failed', {
            loopCount: monitorLoopCount,
            error: errorMessage,
          }, 'error');
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
        appendAuditLog('new-consultation-not-found', {
          loopCount: monitorLoopCount,
        });
        appendRuntimeLog('本轮未发现新的客户咨询');
        console.log(`📋 [${new Date().toLocaleString()}] 无新咨询消息，跳过...`);
      }
    } catch (e) {
      const errorMessage = String(e);
      appendAuditLog('monitor-loop-failed', {
        loopCount: monitorLoopCount,
        error: errorMessage,
      }, 'error');
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

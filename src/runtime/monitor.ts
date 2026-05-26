import { execSync } from 'child_process';
import { askAIAsync } from '../ai-client';
import { loadConfig } from '../reply';
import {
  AI_SENDER_PREFIX,
  SELLER_NAME,
  extractRecentBuyerMessages,
  formatMessagesForPrompt,
  listPendingReplies,
} from '../session';
import { ChatFingerprint, ParsedChatMessage } from '../types';
import { readMessages, readParsedChat, openChat, openChatByBuyerName, scanBuyerList } from './read';
import { sendReply } from './send';
import {
  clickAt,
  closePopups,
  getNewConsultationWindowInfo,
  getQianniuWindowNames,
  hasServiceAttitudePrompt,
  loadRecordedPoint,
  resolveServiceAttitudePrompt,
} from './window';
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

type SessionStatus =
  | 'needs-intro'
  | 'waiting-ai'
  | 'ai-ready'
  | 'watching'
  | 'queued';

type ParsedChatResult = Awaited<ReturnType<typeof readParsedChat>>;

interface BuyerSessionTask {
  buyerName: string;
  latestFingerprint: ChatFingerprint;
  latestTranscript: string;
  latestPromptBody: string;
  recentBuyerMessages: ParsedChatMessage[];
  currentRoundId: string;
  introSent: boolean;
  refreshQuickReplySentRoundId: string;
  queueNoticeSent: boolean;
  aiRequestedRoundId: string;
  aiReadyRoundId: string;
  aiDraft: string;
  aiTimedOut: boolean;
  aiError: string;
  aiAttemptRoundId: string;
  aiAttemptCount: number;
  status: SessionStatus;
  statusNote: string;
  createdAtMs: number;
  updatedAtMs: number;
}

const INITIAL_THINKING_QUICK_REPLY = '收到，我先看一下您这边的具体情况。';
const MULTI_MESSAGE_QUICK_REPLIES = [
  '收到，我会以您最新补充的信息为准继续处理。',
  '好的，您刚补充的内容我已经看到，我继续为您核对。',
  '明白了，我按您最新发来的内容继续确认。',
  '好的，我会结合您刚刚补充的情况继续处理。',
];
const QUEUE_NOTICE_REPLY = '您好，我已收到您的消息，当前正在依次处理咨询，稍后会优先根据您最新消息回复您。';
const AI_MAX_RETRY_PER_ROUND = 2;

let isRunning = false;
let autoReplyEnabled = true;
let monitorLoopCount = 0;
// 运行期只允许一个活跃买家操作 GUI，其余买家进入队列等待，避免线程和窗口焦点互相打架。
let activeBuyerSession: BuyerSessionTask | null = null;
const queuedBuyerSessions = new Map<string, BuyerSessionTask>();
const inflightAiRequests = new Set<string>();

function sleep(ms: number): void {
  execSync(`sleep ${Math.max(0, ms) / 1000}`);
}

function isSameBuyer(expected: string, actual: string): boolean {
  const left = expected.trim();
  const right = actual.trim();
  if (!left || !right) return false;
  return left === right
    || left.includes(right)
    || right.includes(left);
}

function createRoundId(fingerprint: ChatFingerprint): string {
  return `${fingerprint.lastMessageAt}::${fingerprint.lastBuyerMessage}`;
}

function createReplyKey(buyerName: string, roundId: string, kind: string, text: string): string {
  return `${buyerName}::${roundId}::${kind}::${text.trim()}`;
}

function buildPromptBody(parsedMessages: ParsedChatMessage[], fingerprint: ChatFingerprint): {
  promptBody: string;
  recentBuyerMessages: ParsedChatMessage[];
} {
  const recentBuyerMessages = extractRecentBuyerMessages(parsedMessages, 4);
  return {
    promptBody: [
      `当前店铺卖家账号名是：${SELLER_NAME}`,
      `当前买家账号名是：${fingerprint.buyerName}`,
      '以下是当前会话最近解析到的聊天记录：',
      formatMessagesForPrompt(parsedMessages.slice(-12)),
      '',
      '以下是买家最近发来的重点消息：',
      formatMessagesForPrompt(recentBuyerMessages),
    ].join('\n'),
    recentBuyerMessages,
  };
}

function buildAiPrompt(promptBody: string): string {
  return [
    promptBody,
    '',
    '规则：',
    '1. 你现在是淘宝店铺客服，只能以卖家客服身份回复。',
    '2. 如果判断买家还没讲完、信息不完整，优先礼貌追问情况。',
    '3. 如果信息已经完整，再直接给出专业答复。',
    '4. 回复控制在 120 字以内，语气专业、自然，不要表现出不耐烦。',
  ].join('\n');
}

function looksLikeContaminatedTranscript(transcript: string): boolean {
  const trimmed = transcript.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('/Users/')
    || trimmed.startsWith('CyanBukkit香果智能客服:')
    || trimmed.includes('服务态度@fixed')
    || trimmed.includes('/qianniu-automation/data/');
}

function pickRefreshQuickReply(session: BuyerSessionTask): string {
  const pool = session.recentBuyerMessages.length >= 2
    ? MULTI_MESSAGE_QUICK_REPLIES
    : [MULTI_MESSAGE_QUICK_REPLIES[0]];
  return pool[Math.floor(Math.random() * pool.length)];
}

function hasNewConsultationWindow(): boolean {
  const windowNames = getQianniuWindowNames();
  const matchedWindows = windowNames.filter(name => name.trim().endsWith('消息提醒'));
  const blockedWindows = windowNames.filter(name => name.trim().endsWith('消息通知'));
  appendAuditLog('new-consultation-check', {
    windowNames,
    matchedWindows,
    blockedWindows,
    matched: matchedWindows.length > 0,
  });
  return matchedWindows.length > 0;
}

function updateRuntimeForSession(note?: string): void {
  const queueNames = Array.from(queuedBuyerSessions.keys());
  const session = activeBuyerSession;
  if (!session) {
    updateRuntimeSession({
      buyerName: '',
      tailSignature: '',
      lastMessageAt: '',
      parsedMessageCount: 0,
      transcriptPreview: '',
      buyerMessagesPreview: [],
      lastAIReply: '',
      status: queueNames.length > 0 ? 'queue-waiting' : 'idle',
      statusNote: note || (queueNames.length > 0
        ? `排队 ${queueNames.length} 人：${queueNames.join(', ')}`
        : ''),
    });
    return;
  }

  updateRuntimeSession({
    buyerName: session.buyerName,
    tailSignature: session.latestFingerprint.tailSignature,
    lastMessageAt: session.latestFingerprint.lastMessageAt,
    parsedMessageCount: session.latestFingerprint.messageCount,
    transcriptPreview: session.latestTranscript || '',
    buyerMessagesPreview: session.recentBuyerMessages.map(message => formatMessagesForPrompt([message])),
    lastAIReply: session.aiDraft || '',
    status: session.status,
    statusNote: note || `${session.statusNote}${queueNames.length > 0 ? ` | 排队 ${queueNames.length} 人：${queueNames.join(', ')}` : ''}`,
  });
}

function createSessionFromObservation(chat: ParsedChatResult, status: SessionStatus): BuyerSessionTask {
  const { promptBody, recentBuyerMessages } = buildPromptBody(chat.parsedMessages, chat.fingerprint);
  const now = Date.now();
  return {
    buyerName: chat.fingerprint.buyerName,
    latestFingerprint: chat.fingerprint,
    latestTranscript: chat.transcript,
    latestPromptBody: promptBody,
    recentBuyerMessages,
    currentRoundId: createRoundId(chat.fingerprint),
    introSent: false,
    refreshQuickReplySentRoundId: '',
    queueNoticeSent: false,
    aiRequestedRoundId: '',
    aiReadyRoundId: '',
    aiDraft: '',
    aiTimedOut: false,
    aiError: '',
    aiAttemptRoundId: '',
    aiAttemptCount: 0,
    status,
    statusNote: status === 'queued' ? '已进入队列等待处理' : '准备发送首句思考语',
    createdAtMs: now,
    updatedAtMs: now,
  };
}

function syncSessionFromObservation(
  session: BuyerSessionTask,
  chat: ParsedChatResult,
  nextStatusWhenRoundChanges: SessionStatus
): boolean {
  const previousRoundId = session.currentRoundId;
  const { promptBody, recentBuyerMessages } = buildPromptBody(chat.parsedMessages, chat.fingerprint);
  session.latestFingerprint = chat.fingerprint;
  session.latestTranscript = chat.transcript;
  session.latestPromptBody = promptBody;
  session.recentBuyerMessages = recentBuyerMessages;
  session.updatedAtMs = Date.now();

  const nextRoundId = createRoundId(chat.fingerprint);
  if (nextRoundId === previousRoundId) {
    return false;
  }

  session.currentRoundId = nextRoundId;
  session.aiRequestedRoundId = '';
  session.aiReadyRoundId = '';
  session.aiDraft = '';
  session.aiTimedOut = false;
  session.aiError = '';
  session.aiAttemptRoundId = '';
  session.aiAttemptCount = 0;
  session.status = nextStatusWhenRoundChanges;
  session.statusNote = session.introSent
    ? '检测到买家新消息，准备进入下一轮'
    : '首次接待，准备发送首句思考语';
  appendAuditLog('buyer-round-changed', {
    buyerName: session.buyerName,
    previousRoundId,
    nextRoundId,
    status: session.status,
  });
  return true;
}

function normalizeAIReply(text: string): string {
  return text.startsWith(AI_SENDER_PREFIX)
    ? text
    : `${AI_SENDER_PREFIX} ${text}`.trim();
}

function resolveServicePromptIfNeeded(stage: string): void {
  if (!hasServiceAttitudePrompt()) return;
  const resolved = resolveServiceAttitudePrompt();
  appendAuditLog('service-attitude-stage', {
    stage,
    resolved,
  }, resolved ? 'warn' : 'error');
}

async function readCurrentChat(reason: string): Promise<ParsedChatResult | null> {
  resolveServicePromptIfNeeded(`${reason}-before-read`);
  let chat = await readParsedChat();
  if (!chat.transcript.trim() || looksLikeContaminatedTranscript(chat.transcript)) {
    appendAuditLog('chat-read-retry', {
      reason,
      transcriptPreview: chat.transcript.slice(0, 300),
    }, 'warn');
    sleep(800);
    resolveServicePromptIfNeeded(`${reason}-retry-before-read`);
    chat = await readParsedChat();
  }

  if (!chat.transcript.trim() || looksLikeContaminatedTranscript(chat.transcript)) {
    appendAuditLog('chat-read-invalid', {
      reason,
      transcriptPreview: chat.transcript.slice(0, 300),
    }, 'warn');
    return null;
  }

  if (!chat.parsedMessages.length || !chat.fingerprint.buyerName || chat.fingerprint.buyerName === 'unknown-buyer') {
    appendAuditLog('chat-read-unparsed', {
      reason,
      transcriptPreview: chat.transcript.slice(0, 300),
      buyerName: chat.fingerprint.buyerName,
      parsedMessageCount: chat.parsedMessages.length,
    }, 'warn');
    return null;
  }

  return chat;
}

async function focusBuyerAndRead(buyerName: string, reason: string): Promise<ParsedChatResult | null> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // 每次读取前都强制重新点选左侧买家，避免剪贴板仍停留在上一个会话。
    const focused = openChatByBuyerName(buyerName);
    appendAuditLog('buyer-focus-attempt', {
      buyerName,
      reason,
      attempt,
      focused,
    }, focused ? 'info' : 'warn');
    if (!focused) {
      sleep(600);
      continue;
    }

    const chat = await readCurrentChat(`${reason}-attempt-${attempt}`);
    if (!chat) {
      sleep(600);
      continue;
    }

    if (isSameBuyer(buyerName, chat.fingerprint.buyerName)) {
      return chat;
    }

    appendAuditLog('buyer-focus-mismatch', {
      buyerName,
      actualBuyerName: chat.fingerprint.buyerName,
      reason,
      attempt,
    }, 'warn');
    sleep(600);
  }

  return null;
}

function sendSessionReply(session: BuyerSessionTask, text: string, kind: 'intro' | 'refresh' | 'queue' | 'ai'): boolean {
  const replyKey = createReplyKey(session.buyerName, session.currentRoundId, kind, text);
  appendAuditLog('session-reply-send', {
    buyerName: session.buyerName,
    roundId: session.currentRoundId,
    kind,
    preview: text.slice(0, 120),
  });
  const ok = sendReply(text);
  appendAuditLog('session-reply-result', {
    buyerName: session.buyerName,
    roundId: session.currentRoundId,
    kind,
    preview: text.slice(0, 120),
    replyKey,
    ok,
  }, ok ? 'info' : 'warn');
  return ok;
}

function startAIRequest(session: BuyerSessionTask): void {
  const requestRoundId = session.currentRoundId;
  const requestKey = `${session.buyerName}::${requestRoundId}`;
  if (inflightAiRequests.has(requestKey)) {
    session.status = 'waiting-ai';
    session.statusNote = 'AI 正在处理中';
    return;
  }

  if (session.aiAttemptRoundId !== requestRoundId) {
    session.aiAttemptRoundId = requestRoundId;
    session.aiAttemptCount = 0;
  }
  session.aiAttemptCount += 1;
  session.aiRequestedRoundId = requestRoundId;
  session.aiReadyRoundId = '';
  session.aiDraft = '';
  session.aiTimedOut = false;
  session.aiError = '';
  session.status = 'waiting-ai';
  session.statusNote = `等待 AI 第 ${session.aiAttemptCount} 次返回`;
  inflightAiRequests.add(requestKey);

  appendAuditLog('ai-request-start', {
    buyerName: session.buyerName,
    roundId: requestRoundId,
    attempt: session.aiAttemptCount,
    promptPreview: session.latestPromptBody.slice(0, 1000),
  });
  updateRuntimeForSession();
  appendRuntimeLog(`发送 AI 请求，买家 ${session.buyerName}，第 ${session.aiAttemptCount} 次`);

  askAIAsync(
    { messages: [{ role: 'user', content: buildAiPrompt(session.latestPromptBody) }] },
    (response) => {
      try {
        // AI 回调只写内存态，不直接碰 GUI；真正发送统一交回主轮询线程。
        const latestSession = activeBuyerSession && isSameBuyer(activeBuyerSession.buyerName, session.buyerName)
          ? activeBuyerSession
          : queuedBuyerSessions.get(session.buyerName) || null;
        if (!latestSession) {
          appendAuditLog('ai-request-drop', {
            buyerName: session.buyerName,
            roundId: requestRoundId,
            reason: 'session-missing',
          }, 'warn');
          return;
        }

        if (latestSession.currentRoundId !== requestRoundId) {
          appendAuditLog('ai-request-stale', {
            buyerName: session.buyerName,
            requestRoundId,
            currentRoundId: latestSession.currentRoundId,
          }, 'warn');
          return;
        }

        if (response.timedOut || response.error) {
          latestSession.aiRequestedRoundId = '';
          latestSession.aiReadyRoundId = '';
          latestSession.aiDraft = '';
          latestSession.aiTimedOut = !!response.timedOut;
          latestSession.aiError = response.error || 'UNKNOWN';
          latestSession.status = 'waiting-ai';
          latestSession.statusNote = response.timedOut
            ? 'AI 超时，准备重试'
            : `AI 失败：${response.error}`;
          appendAuditLog('ai-request-failed', {
            buyerName: session.buyerName,
            roundId: requestRoundId,
            timedOut: !!response.timedOut,
            error: response.error || '',
            attempt: latestSession.aiAttemptCount,
          }, response.timedOut ? 'warn' : 'error');
          return;
        }

        latestSession.aiReadyRoundId = requestRoundId;
        latestSession.aiDraft = normalizeAIReply(response.content || '');
        latestSession.aiTimedOut = false;
        latestSession.aiError = '';
        latestSession.status = 'ai-ready';
        latestSession.statusNote = 'AI 已返回，待主线程发送';
        appendAuditLog('ai-request-finish', {
          buyerName: session.buyerName,
          roundId: requestRoundId,
          responsePreview: latestSession.aiDraft.slice(0, 300),
        });
      } finally {
        inflightAiRequests.delete(requestKey);
      }
    }
  );
}

async function sendQueueNoticeIfNeeded(session: BuyerSessionTask): Promise<void> {
  if (session.queueNoticeSent) {
    appendAuditLog('queue-notice-skip', {
      buyerName: session.buyerName,
      reason: 'already-sent',
    });
    return;
  }

  const chat = await focusBuyerAndRead(session.buyerName, 'queue-notice');
  if (!chat) {
    appendAuditLog('queue-notice-focus-failed', {
      buyerName: session.buyerName,
    }, 'warn');
    return;
  }

  syncSessionFromObservation(session, chat, 'queued');
  const ok = sendSessionReply(session, QUEUE_NOTICE_REPLY, 'queue');
  if (ok) {
    session.queueNoticeSent = true;
    session.status = 'queued';
    session.statusNote = '已发送排队提示，等待当前买家处理完成';
    appendRuntimeLog(`已向排队买家 ${session.buyerName} 发送排队提示`);
  }
}

function upsertQueuedBuyer(chat: ParsedChatResult): BuyerSessionTask {
  const existing = queuedBuyerSessions.get(chat.fingerprint.buyerName);
  if (existing) {
    syncSessionFromObservation(existing, chat, 'queued');
    existing.status = 'queued';
    existing.statusNote = existing.queueNoticeSent
      ? '排队中，已更新为最新消息'
      : '排队中，等待发送排队提示';
    queuedBuyerSessions.set(existing.buyerName, existing);
    return existing;
  }

  const created = createSessionFromObservation(chat, 'queued');
  created.statusNote = '排队中，等待发送排队提示';
  queuedBuyerSessions.set(created.buyerName, created);
  appendAuditLog('buyer-queued', {
    buyerName: created.buyerName,
    roundId: created.currentRoundId,
  }, 'warn');
  appendRuntimeLog(`买家 ${created.buyerName} 已进入排队`);
  return created;
}

function promoteNextQueuedBuyer(): void {
  const firstEntry = queuedBuyerSessions.entries().next();
  if (firstEntry.done) {
    activeBuyerSession = null;
    updateRuntimeForSession('当前无活跃会话');
    return;
  }

  const [buyerName, session] = firstEntry.value;
  queuedBuyerSessions.delete(buyerName);
  session.status = session.introSent ? 'waiting-ai' : 'needs-intro';
  session.statusNote = session.introSent
    ? '从队列恢复，准备继续当前轮次'
    : '从队列恢复，准备发送首句思考语';
  activeBuyerSession = session;
  appendAuditLog('buyer-resumed', {
    buyerName: session.buyerName,
    roundId: session.currentRoundId,
    queueRemaining: queuedBuyerSessions.size,
  }, 'warn');
  appendRuntimeLog(`恢复排队买家 ${session.buyerName}`);
  updateRuntimeForSession();
}

function finishActiveBuyer(reason: string): void {
  if (!activeBuyerSession) return;
  appendAuditLog('buyer-finished', {
    buyerName: activeBuyerSession.buyerName,
    roundId: activeBuyerSession.currentRoundId,
    reason,
  });
  appendRuntimeLog(`结束买家 ${activeBuyerSession.buyerName} 当前任务：${reason}`);
  activeBuyerSession = null;
  promoteNextQueuedBuyer();
}

async function handleReminderWindow(): Promise<void> {
  const consultationWindow = getNewConsultationWindowInfo();
  if (!consultationWindow) {
    appendAuditLog('new-consultation-race-miss', {
      loopCount: monitorLoopCount,
    }, 'warn');
    return;
  }

  const newConsultPoint = loadRecordedPoint('新的客户咨询');
  if (!newConsultPoint) {
    appendAuditLog('new-consultation-point-miss', {
      loopCount: monitorLoopCount,
      consultationWindowName: consultationWindow.name,
    }, 'warn');
    return;
  }

  appendAuditLog('new-consultation-click', {
    loopCount: monitorLoopCount,
    x: newConsultPoint.x,
    y: newConsultPoint.y,
    consultationWindowName: consultationWindow.name,
  });
  clickAt(newConsultPoint.x, newConsultPoint.y);
  sleep(1500);
  await closePopups();

  const chat = await readCurrentChat('reminder-window');
  if (!chat) {
    appendRuntimeLog('点击消息提醒后未读取到有效聊天内容', 'warn');
    return;
  }

  appendAuditLog('reminder-chat-read', {
    buyerName: chat.fingerprint.buyerName,
    roundId: createRoundId(chat.fingerprint),
    tailSignature: chat.fingerprint.tailSignature,
  });

  if (!activeBuyerSession) {
    activeBuyerSession = createSessionFromObservation(chat, 'needs-intro');
    appendAuditLog('active-session-created', {
      buyerName: activeBuyerSession.buyerName,
      roundId: activeBuyerSession.currentRoundId,
      source: 'reminder-window',
    });
    appendRuntimeLog(`接管新买家 ${activeBuyerSession.buyerName}`);
    updateRuntimeForSession();
    return;
  }

  if (isSameBuyer(activeBuyerSession.buyerName, chat.fingerprint.buyerName)) {
    const roundChanged = syncSessionFromObservation(activeBuyerSession, chat, 'waiting-ai');
    activeBuyerSession.statusNote = roundChanged
      ? '提醒窗口确认同一买家有新消息'
      : '提醒窗口确认同一买家，无新增消息';
    appendAuditLog('active-session-reminder-refresh', {
      buyerName: activeBuyerSession.buyerName,
      roundChanged,
      roundId: activeBuyerSession.currentRoundId,
    });
    updateRuntimeForSession();
    return;
  }

  const queuedSession = upsertQueuedBuyer(chat);
  await sendQueueNoticeIfNeeded(queuedSession);
  updateRuntimeForSession(`买家 ${queuedSession.buyerName} 已排队，准备切回 ${activeBuyerSession.buyerName}`);
}

async function progressActiveBuyer(): Promise<void> {
  if (!activeBuyerSession) {
    if (queuedBuyerSessions.size > 0) {
      promoteNextQueuedBuyer();
    }
    return;
  }

  const session = activeBuyerSession;
  const chat = await focusBuyerAndRead(session.buyerName, 'active-progress');
  if (!chat) {
    session.statusNote = '无法重新定位当前买家，下一轮重试';
    appendRuntimeLog(`无法切回买家 ${session.buyerName}，下一轮重试`, 'warn');
    updateRuntimeForSession();
    return;
  }

  const roundChanged = syncSessionFromObservation(session, chat, session.introSent ? 'waiting-ai' : 'needs-intro');
  if (roundChanged && session.introSent) {
    appendRuntimeLog(`买家 ${session.buyerName} 补充了新消息，旧轮次作废`);
  }

  if (!session.introSent) {
    setRuntimePhase('发送首句快捷语');
    updateRuntimeForSession('发送首句思考语');
    const ok = sendSessionReply(session, INITIAL_THINKING_QUICK_REPLY, 'intro');
    if (!ok) {
      session.statusNote = '首句发送失败，等待下一轮重试';
      updateRuntimeForSession();
      return;
    }
    session.introSent = true;
    session.status = 'waiting-ai';
    session.statusNote = '首句已发，准备请求 AI';
    appendRuntimeLog(`已向买家 ${session.buyerName} 发送首句思考语`);
  } else if (roundChanged && session.refreshQuickReplySentRoundId !== session.currentRoundId) {
    setRuntimePhase('发送补充确认语');
    const refreshReply = pickRefreshQuickReply(session);
    updateRuntimeForSession('买家补充了新消息，发送继续处理提示');
    const ok = sendSessionReply(session, refreshReply, 'refresh');
    if (ok) {
      session.refreshQuickReplySentRoundId = session.currentRoundId;
      session.statusNote = '已按最新消息继续处理，准备重新请求 AI';
      appendRuntimeLog(`已向买家 ${session.buyerName} 发送补充确认语`);
    }
  }

  if (session.aiReadyRoundId === session.currentRoundId && session.aiDraft) {
    setRuntimePhase('发送 AI 回复');
    updateRuntimeForSession('AI 已返回，准备发送');

    const refreshedChat = await readCurrentChat('before-ai-send');
    if (!refreshedChat || !isSameBuyer(session.buyerName, refreshedChat.fingerprint.buyerName)) {
      session.statusNote = '发送前校验买家失败，下一轮重试';
      updateRuntimeForSession();
      return;
    }

    const changedBeforeSend = syncSessionFromObservation(session, refreshedChat, 'waiting-ai');
    if (changedBeforeSend) {
      session.statusNote = '发送前发现买家又发新消息，旧 AI 作废';
      appendAuditLog('ai-send-invalidated', {
        buyerName: session.buyerName,
        roundId: session.currentRoundId,
      }, 'warn');
      updateRuntimeForSession();
      return;
    }

    const ok = sendSessionReply(session, session.aiDraft, 'ai');
    if (!ok) {
      session.statusNote = 'AI 发送失败，下一轮重试';
      updateRuntimeForSession();
      return;
    }

    session.status = 'watching';
    session.statusNote = 'AI 已发送，5 秒后复查是否有新消息';
    appendRuntimeLog(`AI 回复已发送给 ${session.buyerName}`);
    updateRuntimeForSession();
    return;
  }

  if (session.status === 'watching' && session.aiReadyRoundId === session.currentRoundId) {
    session.statusNote = '当前轮次无新消息，结束任务';
    updateRuntimeForSession();
    finishActiveBuyer('watching-no-change');
    return;
  }

  if (session.aiRequestedRoundId === session.currentRoundId && inflightAiRequests.has(`${session.buyerName}::${session.currentRoundId}`)) {
    session.status = 'waiting-ai';
    session.statusNote = '等待 AI 返回中';
    updateRuntimeForSession();
    return;
  }

  if (session.aiError || session.aiTimedOut) {
    if (session.aiAttemptCount >= AI_MAX_RETRY_PER_ROUND) {
      session.statusNote = `AI 连续失败 ${session.aiAttemptCount} 次，结束当前任务`;
      updateRuntimeForSession();
      finishActiveBuyer(session.aiTimedOut ? 'ai-timeout-max-retry' : `ai-error:${session.aiError}`);
      return;
    }
  }

  setRuntimePhase('等待 AI');
  startAIRequest(session);
  updateRuntimeForSession();
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
  activeBuyerSession = null;
  queuedBuyerSessions.clear();
  inflightAiRequests.clear();

  setRuntimeRunning(true, 'booting');
  setRuntimeAutoReply(autoReplyEnabled);
  setRuntimePendingReplyCount(listPendingReplies().filter(reply => reply.status !== 'resolved' && reply.status !== 'ignored').length);
  appendRuntimeLog(`监听启动，间隔 ${intervalMs}ms`);

  console.log(`\n⏳ 监听中，每 ${intervalMs / 1000}s 检查一次...`);
  console.log(`🤖 任务状态: ${autoReplyEnabled ? '运行中' : '已暂停'}`);
  console.log('按 Ctrl+C 停止\n');

  const replyConfig = loadConfig();
  console.log(`📋 已加载 ${replyConfig.rules.filter(rule => rule.enabled).length} 条生效规则\n`);

  while (isRunning) {
    monitorLoopCount += 1;
    markRuntimePoll(monitorLoopCount, intervalMs);

    try {
      clearRuntimeError();
      setRuntimeBuyers(scanBuyerList());
      setRuntimePendingReplyCount(listPendingReplies().filter(reply => reply.status !== 'resolved' && reply.status !== 'ignored').length);

      if (!autoReplyEnabled) {
        setRuntimePhase('paused');
        updateRuntimeForSession('任务已暂停');
        appendRuntimeLog('任务已暂停，跳过本轮监听');
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        continue;
      }

      if (hasNewConsultationWindow()) {
        setRuntimePhase('处理消息提醒');
        await handleReminderWindow();
      } else {
        appendAuditLog('new-consultation-not-found', {
          loopCount: monitorLoopCount,
          activeBuyer: activeBuyerSession?.buyerName || '',
          queue: Array.from(queuedBuyerSessions.keys()),
        });
      }

      setRuntimePhase('推进当前买家');
      await progressActiveBuyer();

      if (!activeBuyerSession && queuedBuyerSessions.size === 0) {
        setRuntimePhase('空闲等待');
        updateRuntimeForSession('本轮未发现需要继续处理的买家');
        appendRuntimeLog('本轮未发现新的客户咨询');
        console.log(`📋 [${new Date().toLocaleString()}] 无新咨询消息，跳过...`);
      }
    } catch (error) {
      const errorMessage = String(error);
      appendAuditLog('monitor-loop-failed', {
        loopCount: monitorLoopCount,
        error: errorMessage,
      }, 'error');
      setRuntimeError(errorMessage);
      appendRuntimeLog(`处理失败: ${errorMessage}`, 'error');
      console.error('处理失败:', error);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  setRuntimeRunning(false, 'stopped');
  updateRuntimeForSession('监听已停止');
  appendRuntimeLog('监听已停止');
}

export async function patrolCycle(): Promise<void> {
  appendRuntimeLog('开始巡店');
  console.log('🔍 开始巡店...\n');

  const newConsultPoint = loadRecordedPoint('新的客户咨询');
  if (newConsultPoint) {
    clickAt(newConsultPoint.x, newConsultPoint.y);
    sleep(1000);
  }

  const buyers = scanBuyerList();
  setRuntimeBuyers(buyers);
  console.log(`发现 ${buyers.length} 个接待中:`, buyers.map(buyer => buyer.name).join(', '));

  for (const buyer of buyers) {
    console.log(`\n👉 进入 ${buyer.name}...`);
    openChat(buyer);

    const messages = await readMessages();
    console.log(`  消息 (${messages.length} 条):`);
    messages.slice(-4).forEach(message => console.log(`    ${message}`));

    if (messages.length > 0) {
      console.log(`  最新: ${messages[messages.length - 1]}`);
    }
  }

  console.log('\n✅ 巡店完成');
}

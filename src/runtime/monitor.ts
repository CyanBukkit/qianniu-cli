import { execSync } from 'child_process';
import { askAI, askAIAsync } from '../ai-client';
import { loadConfig } from '../reply';
import {
  AI_SENDER_PREFIX,
  SELLER_NAME,
  deletePendingReply,
  extractRecentBuyerMessages,
  formatMessagesForPrompt,
  listPendingReplies,
  savePendingReply,
} from '../session';
import { ChatFingerprint, ParsedChatMessage } from '../types';
import { openChat, openChatByBuyerName, readMessages, readParsedChat, scanBuyerList } from './read';
import { sendReply } from './send';
import {
  activateReception,
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

type SessionStatus = 'needs-intro' | 'waiting-ai' | 'ai-ready' | 'queued';
type ParsedChatResult = Awaited<ReturnType<typeof readParsedChat>>;

interface BuyerSessionTask {
  buyerName: string;
  latestFingerprint: ChatFingerprint;
  latestTranscript: string;
  latestPromptBody: string;
  recentBuyerMessages: ParsedChatMessage[];
  latestRoundId: string;
  lastMessageSenderRole: 'buyer' | 'seller' | 'unknown';
  introSent: boolean;
  queueNoticeSentRoundId: string;
  aiRequestRoundId: string;
  aiRequested: boolean;
  aiReady: boolean;
  aiDraft: string;
  aiTimedOut: boolean;
  aiError: string;
  status: SessionStatus;
  statusNote: string;
  createdAtMs: number;
  updatedAtMs: number;
}

const INITIAL_THINKING_QUICK_REPLIES = [
  '收到，我先看一下您这边的具体情况。',
  '好的，我先为您核对一下当前情况。',
  '收到，我先结合您说的内容看一下。',
  '明白了，我先帮您确认一下具体情况。',
  '好的，我先查看一下您这边的问题。',
  '收到，我这边先了解一下具体情况。',
  '好的，我先按您刚说的情况核对一下。',
  '明白，我先帮您看一下当前情况。',
  '收到，我先为您确认一下相关情况。',
  '好的，我先看一下您这里的具体问题。',
  '收到，我先核实一下您反馈的情况。',
  '明白了，我先帮您查看一下。',
  '好的，我先根据您提供的信息确认一下。',
  '收到，我先这边帮您看一下。',
  '好的，我先了解一下您当前的情况。',
  '收到，我先替您核对一下。',
  '明白，我先确认下您这边的具体情况。',
  '好的，我先帮您看看这个情况。',
  '收到，我先按您描述的内容查一下。',
  '好的，我先为您看一下这边的情况。',
];

const QUEUE_NOTICE_REPLIES = [
  '您好，我已收到您的消息，当前正在依次处理咨询，稍后会优先根据您最新消息回复您。',
  '您好，消息已经收到，这边正在依次处理当前咨询，稍后会尽快按您最新内容回复您。',
  '您好，我这边已经看到您的消息，当前咨询较多，稍后会根据您最新发送的内容尽快回复您。',
  '您好，已收到您的咨询，这边正在按顺序处理，稍后会优先结合您最新消息回复您。',
  '您好，您的消息我已经收到了，当前正在依次处理会话，稍后尽快回复您。',
  '您好，已经收到您的消息，这边会按当前排队顺序处理，并以您最新发送的内容为准回复您。',
  '您好，我已看到您的消息，当前正在处理中其他咨询，稍后会尽快回复您这边。',
  '您好，消息已收到，这边正在依次接待，稍后会结合您最新补充的信息回复您。',
  '您好，您的咨询我这边已经收到，当前会按顺序处理，稍后尽快联系您。',
  '您好，已收到您的消息，请您稍等一下，这边会根据您最新发送的内容尽快回复。',
  '您好，我这边已经收到您的咨询，当前正在依次处理，稍后会优先回复您最新的问题。',
  '您好，消息已经看到，这边会按顺序继续处理，稍后尽快给您答复。',
  '您好，已收到您的咨询内容，这边正在逐一处理消息，稍后会回复您。',
  '您好，您的消息已收到，当前会按顺序接待，稍后结合最新内容尽快回复您。',
  '您好，我已收到您发来的消息，这边正在处理当前咨询，稍后马上继续回复您。',
  '您好，消息我这边已经看到了，当前正在依次处理会话，稍后会尽快回复您。',
  '您好，已收到您的消息，请您稍候，这边会按您最新补充的内容继续处理并回复您。',
  '您好，我这边已收到您的咨询，当前正在排队处理中，稍后会尽快回复您。',
  '您好，消息收到，这边会按顺序处理当前咨询，稍后根据您最新消息回复您。',
  '您好，我已经看到您的消息，当前正在逐一处理，稍后会尽快给您回复。',
];

let isRunning = false;
let autoReplyEnabled = true;
let monitorLoopCount = 0;
let activeBuyerSession: BuyerSessionTask | null = null;
const queuedBuyerSessions = new Map<string, BuyerSessionTask>();
const queuedBuyerOrder: string[] = [];
const inflightAiRequests = new Set<string>();
const completedRoundKeys = new Set<string>();

function sleep(ms: number): void {
  execSync(`sleep ${Math.max(0, ms) / 1000}`);
}

function isSameBuyer(expected: string, actual: string): boolean {
  const left = expected.trim();
  const right = actual.trim();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function createRoundId(fingerprint: ChatFingerprint): string {
  return `${fingerprint.lastMessageAt}::${fingerprint.lastBuyerMessage}`;
}

function createCompletedRoundKey(buyerName: string, roundId: string): string {
  return `${buyerName}::${roundId}`;
}

function pickRandomReply(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

function normalizeAIReply(text: string): string {
  return text.startsWith(AI_SENDER_PREFIX)
    ? text
    : `${AI_SENDER_PREFIX} ${text}`.trim();
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

function hasNewConsultationWindow(): boolean {
  const windowNames = getQianniuWindowNames();
  const matchedWindows = windowNames.filter(name => name.trim().endsWith('消息提醒'));
  return matchedWindows.length > 0;
}

function updateRuntimeForSession(note?: string): void {
  const queueNames = queuedBuyerOrder.filter(buyerName => queuedBuyerSessions.has(buyerName));
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
      status: queueNames.length > 0 ? 'queued' : 'idle',
      statusNote: note || (queueNames.length > 0 ? `排队 ${queueNames.length} 人：${queueNames.join(', ')}` : ''),
    });
    return;
  }

  updateRuntimeSession({
    buyerName: session.buyerName,
    tailSignature: session.latestFingerprint.tailSignature,
    lastMessageAt: session.latestFingerprint.lastMessageAt,
    parsedMessageCount: session.latestFingerprint.messageCount,
    transcriptPreview: session.latestTranscript,
    buyerMessagesPreview: session.recentBuyerMessages.map(message => formatMessagesForPrompt([message])),
    lastAIReply: session.aiDraft || '',
    status: session.status,
    statusNote: note || `${session.statusNote}${queueNames.length > 0 ? ` | 排队 ${queueNames.length} 人：${queueNames.join(', ')}` : ''}`,
  });
}

function createSessionFromChat(chat: ParsedChatResult, status: SessionStatus): BuyerSessionTask {
  const { promptBody, recentBuyerMessages } = buildPromptBody(chat.parsedMessages, chat.fingerprint);
  const now = Date.now();
  const lastMessage = chat.parsedMessages[chat.parsedMessages.length - 1];
  return {
    buyerName: chat.fingerprint.buyerName,
    latestFingerprint: chat.fingerprint,
    latestTranscript: chat.transcript,
    latestPromptBody: promptBody,
    recentBuyerMessages,
    latestRoundId: createRoundId(chat.fingerprint),
    lastMessageSenderRole: lastMessage?.senderRole || 'unknown',
    introSent: false,
    queueNoticeSentRoundId: '',
    aiRequestRoundId: '',
    aiRequested: false,
    aiReady: false,
    aiDraft: '',
    aiTimedOut: false,
    aiError: '',
    status,
    statusNote: status === 'queued' ? '已进入队列等待处理' : '准备发送首句思考语',
    createdAtMs: now,
    updatedAtMs: now,
  };
}

function updateSessionFromChat(session: BuyerSessionTask, chat: ParsedChatResult): boolean {
  const { promptBody, recentBuyerMessages } = buildPromptBody(chat.parsedMessages, chat.fingerprint);
  const previousRoundId = session.latestRoundId;
  const nextRoundId = createRoundId(chat.fingerprint);
  const lastMessage = chat.parsedMessages[chat.parsedMessages.length - 1];

  session.latestFingerprint = chat.fingerprint;
  session.latestTranscript = chat.transcript;
  session.latestPromptBody = promptBody;
  session.recentBuyerMessages = recentBuyerMessages;
  session.latestRoundId = nextRoundId;
  session.lastMessageSenderRole = lastMessage?.senderRole || 'unknown';
  session.updatedAtMs = Date.now();

  return previousRoundId !== nextRoundId;
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
    // 每次读取前都强制点回左侧买家，确保复制的是当前目标会话。
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

function sendSessionReply(session: BuyerSessionTask, text: string, kind: 'intro' | 'queue' | 'ai'): boolean {
  appendAuditLog('session-reply-send', {
    buyerName: session.buyerName,
    roundId: session.latestRoundId,
    kind,
    preview: text.slice(0, 120),
  });
  const ok = sendReply(text);
  appendAuditLog('session-reply-result', {
    buyerName: session.buyerName,
    roundId: session.latestRoundId,
    kind,
    preview: text.slice(0, 120),
    ok,
  }, ok ? 'info' : 'warn');
  return ok;
}

function markCompletedRound(buyerName: string, roundId: string, reason: string): void {
  completedRoundKeys.add(createCompletedRoundKey(buyerName, roundId));
  appendAuditLog('buyer-round-completed', {
    buyerName,
    roundId,
    reason,
  });
}

function createPendingReplyId(): string {
  return `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function saveAiDraftToPending(session: BuyerSessionTask, currentChat: ParsedChatResult, reason: string): void {
  if (!session.aiDraft.trim()) {
    appendAuditLog('pending-reply-skip', {
      buyerName: session.buyerName,
      roundId: session.aiRequestRoundId || session.latestRoundId,
      reason: 'empty-ai-draft',
      pendingReason: reason,
    }, 'warn');
    return;
  }

  const pendingId = createPendingReplyId();
  savePendingReply({
    id: pendingId,
    createdAt: new Date().toISOString(),
    buyerName: session.buyerName,
    requestedFingerprint: session.latestFingerprint,
    currentFingerprint: currentChat.fingerprint,
    originalTranscript: session.latestTranscript,
    draft: session.aiDraft,
    reason,
    status: 'pending',
    note: '异买家打断，等待人工处理',
  });
  appendAuditLog('pending-reply-saved', {
    pendingId,
    buyerName: session.buyerName,
    currentBuyerName: currentChat.fingerprint.buyerName,
    roundId: session.aiRequestRoundId || session.latestRoundId,
    reason,
    draftPreview: session.aiDraft.slice(0, 300),
  }, 'warn');
  setRuntimePendingReplyCount(listPendingReplies().filter(reply => reply.status !== 'resolved' && reply.status !== 'ignored').length);
  appendRuntimeLog(`AI 草稿已转待发 ${pendingId}，买家 ${session.buyerName}`, 'warn');
  try {
    execSync('afplay /System/Library/Sounds/Glass.aiff', { timeout: 2000 });
  } catch {
    // 忽略提示音失败
  }
}

function listPendingRepliesByBuyer(buyerName: string): ReturnType<typeof listPendingReplies> {
  return listPendingReplies().filter(reply =>
    reply.status !== 'resolved'
    && reply.status !== 'ignored'
    && isSameBuyer(reply.buyerName, buyerName)
  );
}

async function buildPendingReplyDeliveryText(buyerName: string): Promise<string | null> {
  const pendingReplies = listPendingRepliesByBuyer(buyerName);
  if (pendingReplies.length === 0) return null;

  if (pendingReplies.length === 1) {
    return `我们继续说，${pendingReplies[0].draft.trim()} 如果您这边有新的情况，也欢迎继续告诉我。`;
  }

  const summaryPrompt = [
    `当前店铺卖家账号名是：${SELLER_NAME}`,
    `当前买家账号名是：${buyerName}`,
    '下面这些内容是之前没来得及发给同一个买家的多条待发客服回复，请你合并整理成一条自然、连贯、专业的客服回复。',
    '要求：',
    '1. 必须保留核心信息，不要遗漏关键答复。',
    '2. 语气自然专业，不要生硬罗列。',
    '3. 控制在 180 字以内。',
    '4. 不要输出解释，只输出最终要发给买家的话。',
    '',
    '待发回复如下：',
    pendingReplies.map((reply, index) => `${index + 1}. ${reply.draft}`).join('\n'),
  ].join('\n');

  try {
    const response = await askAI({
      messages: [{ role: 'user', content: summaryPrompt }],
      max_tokens: 500,
    });
    const merged = normalizeAIReply(response.content || '').trim();
    if (!merged) {
      return `我们继续说，${pendingReplies.map(reply => reply.draft.trim()).join(' ')} 如果您这边有新的情况，也欢迎继续告诉我。`;
    }
    return `我们继续说，${merged} 如果您这边有新的情况，也欢迎继续告诉我。`;
  } catch (error) {
    appendAuditLog('pending-reply-merge-failed', {
      buyerName,
      count: pendingReplies.length,
      error: String(error),
    }, 'warn');
    return `我们继续说，${pendingReplies.map(reply => reply.draft.trim()).join(' ')} 如果您这边有新的情况，也欢迎继续告诉我。`;
  }
}

async function flushPendingRepliesForBuyer(buyerName: string): Promise<boolean> {
  const pendingReplies = listPendingRepliesByBuyer(buyerName);
  if (pendingReplies.length === 0) {
    return false;
  }

  const deliveryText = await buildPendingReplyDeliveryText(buyerName);
  if (!deliveryText) {
    appendAuditLog('pending-reply-flush-skip', {
      buyerName,
      reason: 'empty-delivery-text',
      count: pendingReplies.length,
    }, 'warn');
    return false;
  }

  const focusedChat = await focusBuyerAndRead(buyerName, 'flush-pending');
  if (!focusedChat) {
    appendAuditLog('pending-reply-flush-skip', {
      buyerName,
      reason: 'focus-failed',
      count: pendingReplies.length,
    }, 'warn');
    return false;
  }

  const tempSession = createSessionFromChat(focusedChat, 'ai-ready');
  tempSession.statusNote = `发送 ${pendingReplies.length} 条待发汇总消息`;
  updateRuntimeForSession(tempSession.statusNote);
  const ok = sendSessionReply(tempSession, deliveryText, 'ai');
  if (!ok) {
    appendAuditLog('pending-reply-flush-failed', {
      buyerName,
      count: pendingReplies.length,
    }, 'warn');
    return false;
  }

  for (const reply of pendingReplies) {
    deletePendingReply(reply.id);
  }
  setRuntimePendingReplyCount(listPendingReplies().filter(reply => reply.status !== 'resolved' && reply.status !== 'ignored').length);
  appendAuditLog('pending-reply-flush-finish', {
    buyerName,
    count: pendingReplies.length,
    preview: deliveryText.slice(0, 300),
  }, 'warn');
  appendRuntimeLog(`已向买家 ${buyerName} 发出 ${pendingReplies.length} 条待发汇总消息`, 'warn');
  return true;
}

function enqueueBuyerSession(session: BuyerSessionTask): void {
  queuedBuyerSessions.set(session.buyerName, session);
  if (!queuedBuyerOrder.includes(session.buyerName)) {
    queuedBuyerOrder.push(session.buyerName);
  }
}

function dequeueNextBuyerSession(): BuyerSessionTask | null {
  while (queuedBuyerOrder.length > 0) {
    const buyerName = queuedBuyerOrder.shift()!;
    const session = queuedBuyerSessions.get(buyerName) || null;
    if (!session) continue;
    queuedBuyerSessions.delete(buyerName);
    return session;
  }
  return null;
}

function finishActiveBuyer(reason: string): void {
  if (!activeBuyerSession) return;
  appendAuditLog('buyer-finished', {
    buyerName: activeBuyerSession.buyerName,
    roundId: activeBuyerSession.latestRoundId,
    reason,
  });
  appendRuntimeLog(`结束买家 ${activeBuyerSession.buyerName} 当前任务：${reason}`);
  activeBuyerSession = null;

  const nextQueued = dequeueNextBuyerSession();
  if (nextQueued) {
    nextQueued.status = 'needs-intro';
    nextQueued.statusNote = '从队列恢复，准备发送首句思考语';
    activeBuyerSession = nextQueued;
    appendAuditLog('buyer-resumed', {
      buyerName: nextQueued.buyerName,
      roundId: nextQueued.latestRoundId,
      queueRemaining: queuedBuyerOrder.length,
    }, 'warn');
  }
}

function startAIRequest(session: BuyerSessionTask): void {
  const requestKey = `${session.buyerName}::${session.aiRequestRoundId}`;
  if (inflightAiRequests.has(requestKey)) {
    return;
  }

  session.aiRequested = true;
  session.aiReady = false;
  session.aiDraft = '';
  session.aiTimedOut = false;
  session.aiError = '';
  session.status = 'waiting-ai';
  session.statusNote = '已发送 AI 请求，等待返回';
  inflightAiRequests.add(requestKey);

  appendAuditLog('ai-request-start', {
    buyerName: session.buyerName,
    requestRoundId: session.aiRequestRoundId,
    currentRoundId: session.latestRoundId,
    promptPreview: session.latestPromptBody.slice(0, 1000),
  });

  askAIAsync(
    { messages: [{ role: 'user', content: buildAiPrompt(session.latestPromptBody) }] },
    (response) => {
      try {
        const latestSession = activeBuyerSession && isSameBuyer(activeBuyerSession.buyerName, session.buyerName)
          ? activeBuyerSession
          : queuedBuyerSessions.get(session.buyerName) || null;
        if (!latestSession) {
          appendAuditLog('ai-request-drop', {
            buyerName: session.buyerName,
            requestRoundId: session.aiRequestRoundId,
            reason: 'session-missing',
          }, 'warn');
          return;
        }

        if (latestSession.aiRequestRoundId !== session.aiRequestRoundId) {
          appendAuditLog('ai-request-drop', {
            buyerName: session.buyerName,
            requestRoundId: session.aiRequestRoundId,
            currentRequestRoundId: latestSession.aiRequestRoundId,
            reason: 'request-round-changed',
          }, 'warn');
          return;
        }

        if (response.timedOut || response.error) {
          latestSession.aiReady = false;
          latestSession.aiDraft = '';
          latestSession.aiTimedOut = !!response.timedOut;
          latestSession.aiError = response.error || 'UNKNOWN';
          latestSession.status = 'waiting-ai';
          latestSession.statusNote = response.timedOut
            ? 'AI 超时，等待当前任务结束'
            : `AI 失败：${response.error}`;
          appendAuditLog('ai-request-failed', {
            buyerName: session.buyerName,
            requestRoundId: session.aiRequestRoundId,
            timedOut: !!response.timedOut,
            error: response.error || '',
          }, response.timedOut ? 'warn' : 'error');
          return;
        }

        latestSession.aiReady = true;
        latestSession.aiDraft = normalizeAIReply(response.content || '');
        latestSession.aiTimedOut = false;
        latestSession.aiError = '';
        latestSession.status = 'ai-ready';
        latestSession.statusNote = 'AI 已返回，等待发送';
        appendAuditLog('ai-request-finish', {
          buyerName: session.buyerName,
          requestRoundId: session.aiRequestRoundId,
          currentRoundId: latestSession.latestRoundId,
          responsePreview: latestSession.aiDraft.slice(0, 300),
        });
      } finally {
        inflightAiRequests.delete(requestKey);
      }
    }
  );
}

async function handleNewConsultationReminder(): Promise<void> {
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

  const roundId = createRoundId(chat.fingerprint);
  appendAuditLog('reminder-chat-read', {
    buyerName: chat.fingerprint.buyerName,
    roundId,
    tailSignature: chat.fingerprint.tailSignature,
  });

  if (completedRoundKeys.has(createCompletedRoundKey(chat.fingerprint.buyerName, roundId))) {
    appendAuditLog('reminder-chat-skip', {
      buyerName: chat.fingerprint.buyerName,
      roundId,
      reason: 'round-already-completed',
    }, 'warn');
    return;
  }

  if (!activeBuyerSession) {
    const flushedPending = await flushPendingRepliesForBuyer(chat.fingerprint.buyerName);
    if (flushedPending) {
      markCompletedRound(chat.fingerprint.buyerName, roundId, 'pending-flushed');
      updateRuntimeForSession(`买家 ${chat.fingerprint.buyerName} 已优先发送待发消息`);
      return;
    }
  }

  if (!activeBuyerSession) {
    activeBuyerSession = createSessionFromChat(chat, 'needs-intro');
    appendAuditLog('active-session-created', {
      buyerName: activeBuyerSession.buyerName,
      roundId: activeBuyerSession.latestRoundId,
      source: 'reminder-window',
    });
    appendRuntimeLog(`接管新买家 ${activeBuyerSession.buyerName}`);
    updateRuntimeForSession();
    return;
  }

  if (isSameBuyer(activeBuyerSession.buyerName, chat.fingerprint.buyerName)) {
    const flushedPending = await flushPendingRepliesForBuyer(chat.fingerprint.buyerName);
    if (flushedPending) {
      markCompletedRound(chat.fingerprint.buyerName, roundId, 'pending-flushed-same-buyer');
      finishActiveBuyer('pending-flushed-same-buyer');
      return;
    }

    const roundChanged = updateSessionFromChat(activeBuyerSession, chat);
    appendAuditLog('same-buyer-reminder', {
      buyerName: activeBuyerSession.buyerName,
      roundId: activeBuyerSession.latestRoundId,
      roundChanged,
      aiRequested: activeBuyerSession.aiRequested,
      aiReady: activeBuyerSession.aiReady,
    });

    if (activeBuyerSession.aiRequested && !activeBuyerSession.aiReady && roundChanged) {
      const queueReply = pickRandomReply(QUEUE_NOTICE_REPLIES);
      activeBuyerSession.statusNote = '同一买家继续发消息，发送排队提示并等待 AI';
      updateRuntimeForSession();
      const ok = sendSessionReply(activeBuyerSession, queueReply, 'queue');
      if (ok) {
        activeBuyerSession.queueNoticeSentRoundId = activeBuyerSession.latestRoundId;
        appendRuntimeLog(`已向同一买家 ${activeBuyerSession.buyerName} 发送等待提示`);
      }
    } else {
      activeBuyerSession.statusNote = activeBuyerSession.aiReady
        ? '同一买家有新提醒，等待发送 AI'
        : '同一买家有新提醒，继续等待 AI';
    }

    updateRuntimeForSession();
    return;
  }

  const flushedPending = await flushPendingRepliesForBuyer(chat.fingerprint.buyerName);
  if (flushedPending) {
    markCompletedRound(chat.fingerprint.buyerName, roundId, 'pending-flushed-other-buyer');
    updateRuntimeForSession(`买家 ${chat.fingerprint.buyerName} 已优先发送待发消息`);
    return;
  }

  const queuedSession = createSessionFromChat(chat, 'queued');
  enqueueBuyerSession(queuedSession);
  appendAuditLog('buyer-queued', {
    buyerName: queuedSession.buyerName,
    roundId: queuedSession.latestRoundId,
  }, 'warn');
  appendRuntimeLog(`买家 ${queuedSession.buyerName} 进入队列`);

  const queueReply = pickRandomReply(QUEUE_NOTICE_REPLIES);
  queuedSession.statusNote = `买家 ${queuedSession.buyerName} 排队中，发送等待提示`;
  updateRuntimeForSession();
  const ok = sendSessionReply(queuedSession, queueReply, 'queue');
  if (ok) {
    queuedSession.queueNoticeSentRoundId = queuedSession.latestRoundId;
  }
  updateRuntimeForSession();
}

async function progressActiveBuyerSession(): Promise<void> {
  if (!activeBuyerSession) return;
  const session = activeBuyerSession;

  const chat = await focusBuyerAndRead(session.buyerName, 'active-progress');
  if (!chat) {
    session.statusNote = '无法重新定位当前买家，下一轮重试';
    updateRuntimeForSession();
    return;
  }

  updateSessionFromChat(session, chat);
  if (session.lastMessageSenderRole !== 'buyer' && !session.aiReady) {
    session.statusNote = '当前最后一条不是买家消息，等待新的提醒';
    updateRuntimeForSession();
    return;
  }

  if (!session.introSent) {
    setRuntimePhase('发送首句快捷语');
    const introReply = pickRandomReply(INITIAL_THINKING_QUICK_REPLIES);
    session.statusNote = '发送首句思考语';
    updateRuntimeForSession();
    const ok = sendSessionReply(session, introReply, 'intro');
    if (!ok) {
      session.statusNote = '首句发送失败，等待下一轮重试';
      updateRuntimeForSession();
      return;
    }

    session.introSent = true;
    session.aiRequestRoundId = session.latestRoundId;
    session.status = 'waiting-ai';
    session.statusNote = '首句已发，开始请求 AI';
    appendRuntimeLog(`已向买家 ${session.buyerName} 发送首句思考语`);
    updateRuntimeForSession();
    startAIRequest(session);
    return;
  }

  if (!session.aiReady) {
    session.status = 'waiting-ai';
    session.statusNote = '等待 AI 返回';
    updateRuntimeForSession();
    return;
  }

  setRuntimePhase('发送 AI 回复');
  session.statusNote = 'AI 已返回，准备发送正式回复';
  updateRuntimeForSession();

  const verifyChat = await focusBuyerAndRead(session.buyerName, 'before-ai-send');
  if (!verifyChat) {
    session.statusNote = '发送前买家校验失败，等待下一轮重试';
    updateRuntimeForSession();
    return;
  }

  if (!isSameBuyer(session.buyerName, verifyChat.fingerprint.buyerName)) {
    saveAiDraftToPending(
      session,
      verifyChat,
      `AI 返回后前台已切换到其他买家：原买家=${session.buyerName}，当前买家=${verifyChat.fingerprint.buyerName}`
    );
    markCompletedRound(session.buyerName, session.aiRequestRoundId || session.latestRoundId, 'moved-to-pending-different-buyer');
    session.statusNote = 'AI 草稿已转待发，当前任务结束';
    updateRuntimeForSession();
    finishActiveBuyer('ai-moved-to-pending-different-buyer');
    return;
  }

  updateSessionFromChat(session, verifyChat);
  const ok = sendSessionReply(session, session.aiDraft, 'ai');
  if (!ok) {
    session.statusNote = 'AI 发送失败，等待下一轮重试';
    updateRuntimeForSession();
    return;
  }

  markCompletedRound(session.buyerName, session.aiRequestRoundId || session.latestRoundId, 'ai-sent');
  markCompletedRound(session.buyerName, session.latestRoundId, 'ai-sent-latest');
  session.statusNote = 'AI 已发送，当前任务结束';
  updateRuntimeForSession();
  finishActiveBuyer('ai-sent');
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
  queuedBuyerOrder.length = 0;
  inflightAiRequests.clear();
  completedRoundKeys.clear();

  setRuntimeRunning(true, 'booting');
  setRuntimeAutoReply(autoReplyEnabled);
  setRuntimePendingReplyCount(listPendingReplies().filter(reply => reply.status !== 'resolved' && reply.status !== 'ignored').length);
  activateReception();
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

      activateReception();

      if (hasNewConsultationWindow()) {
        setRuntimePhase('处理消息提醒');
        await handleNewConsultationReminder();
      }

      if (!activeBuyerSession) {
        const nextQueued = dequeueNextBuyerSession();
        if (nextQueued) {
          nextQueued.status = 'needs-intro';
          nextQueued.statusNote = '从队列恢复，准备发送首句思考语';
          activeBuyerSession = nextQueued;
        }
      }

      if (activeBuyerSession) {
        setRuntimePhase('推进当前买家');
        await progressActiveBuyerSession();
      } else {
        setRuntimePhase('空闲等待');
        updateRuntimeForSession('本轮未发现需要继续处理的买家');
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

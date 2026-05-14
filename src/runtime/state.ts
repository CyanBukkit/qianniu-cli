import { Buyer } from '../types';

export interface RuntimeLogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface RuntimeSessionState {
  buyerName: string;
  tailSignature: string;
  lastMessageAt: string;
  parsedMessageCount: number;
  transcriptPreview: string;
  buyerMessagesPreview: string[];
  lastAIReply: string;
  status: string;
}

export interface RuntimeStateSnapshot {
  isRunning: boolean;
  autoReplyEnabled: boolean;
  intervalMs: number;
  phase: string;
  loopCount: number;
  lastPollAt: string;
  lastError: string;
  currentSession: RuntimeSessionState;
  buyers: Buyer[];
  pendingReplyCount: number;
  logs: RuntimeLogEntry[];
}

const MAX_LOGS = 80;

const runtimeState: RuntimeStateSnapshot = {
  isRunning: false,
  autoReplyEnabled: true,
  intervalMs: 5000,
  phase: 'idle',
  loopCount: 0,
  lastPollAt: '',
  lastError: '',
  currentSession: {
    buyerName: '',
    tailSignature: '',
    lastMessageAt: '',
    parsedMessageCount: 0,
    transcriptPreview: '',
    buyerMessagesPreview: [],
    lastAIReply: '',
    status: 'idle',
  },
  buyers: [],
  pendingReplyCount: 0,
  logs: [],
};

export function getRuntimeState(): RuntimeStateSnapshot {
  return {
    ...runtimeState,
    currentSession: {
      ...runtimeState.currentSession,
      buyerMessagesPreview: [...runtimeState.currentSession.buyerMessagesPreview],
    },
    buyers: runtimeState.buyers.map(buyer => ({ ...buyer })),
    logs: runtimeState.logs.map(log => ({ ...log })),
  };
}

export function resetRuntimeState(intervalMs = 5000, autoReplyEnabled = true): void {
  runtimeState.isRunning = false;
  runtimeState.autoReplyEnabled = autoReplyEnabled;
  runtimeState.intervalMs = intervalMs;
  runtimeState.phase = 'idle';
  runtimeState.loopCount = 0;
  runtimeState.lastPollAt = '';
  runtimeState.lastError = '';
  runtimeState.currentSession = {
    buyerName: '',
    tailSignature: '',
    lastMessageAt: '',
    parsedMessageCount: 0,
    transcriptPreview: '',
    buyerMessagesPreview: [],
    lastAIReply: '',
    status: 'idle',
  };
  runtimeState.buyers = [];
  runtimeState.pendingReplyCount = 0;
  runtimeState.logs = [];
}

export function setRuntimeRunning(isRunning: boolean, phase?: string): void {
  runtimeState.isRunning = isRunning;
  if (phase) {
    runtimeState.phase = phase;
  }
}

export function setRuntimePhase(phase: string): void {
  runtimeState.phase = phase;
}

export function markRuntimePoll(loopCount: number, intervalMs: number): void {
  runtimeState.loopCount = loopCount;
  runtimeState.intervalMs = intervalMs;
  runtimeState.lastPollAt = new Date().toISOString();
}

export function setRuntimeAutoReply(enabled: boolean): void {
  runtimeState.autoReplyEnabled = enabled;
}

export function setRuntimeError(error: string): void {
  runtimeState.lastError = error;
}

export function clearRuntimeError(): void {
  runtimeState.lastError = '';
}

export function setRuntimeBuyers(buyers: Buyer[]): void {
  runtimeState.buyers = buyers.map(buyer => ({ ...buyer }));
}

export function setRuntimePendingReplyCount(count: number): void {
  runtimeState.pendingReplyCount = count;
}

export function updateRuntimeSession(patch: Partial<RuntimeSessionState>): void {
  runtimeState.currentSession = {
    ...runtimeState.currentSession,
    ...patch,
    buyerMessagesPreview: patch.buyerMessagesPreview
      ? [...patch.buyerMessagesPreview]
      : [...runtimeState.currentSession.buyerMessagesPreview],
  };
}

export function appendRuntimeLog(
  message: string,
  level: RuntimeLogEntry['level'] = 'info'
): void {
  runtimeState.logs.unshift({
    at: new Date().toISOString(),
    level,
    message,
  });
  if (runtimeState.logs.length > MAX_LOGS) {
    runtimeState.logs.length = MAX_LOGS;
  }
}

import * as fs from 'fs';
import * as path from 'path';
import { ChatFingerprint } from '../types';

const PENDING_REPLIES_PATH = path.join(
  '/Users/liuyuxuanyi/Documents/qianniu-automation/data',
  'pending-replies.json'
);

export interface PendingReply {
  id: string;
  createdAt: string;
  buyerName: string;
  requestedFingerprint: ChatFingerprint;
  currentFingerprint: ChatFingerprint;
  originalTranscript: string;
  draft: string;
  reason: string;
  status: 'pending' | 'reviewing' | 'resolved' | 'ignored';
  note: string;
}

interface PendingReplyStore {
  replies: PendingReply[];
}

function loadStore(): PendingReplyStore {
  try {
    if (!fs.existsSync(PENDING_REPLIES_PATH)) {
      return { replies: [] };
    }

    const raw = fs.readFileSync(PENDING_REPLIES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.replies)) {
      return { replies: parsed.replies };
    }
  } catch (error) {
    console.error('⚠️ 读取 pending-replies.json 失败:', error);
  }

  return { replies: [] };
}

function saveStore(store: PendingReplyStore): void {
  fs.writeFileSync(PENDING_REPLIES_PATH, JSON.stringify(store, null, 2), 'utf8');
}

export function savePendingReply(reply: PendingReply): void {
  const store = loadStore();
  store.replies.unshift(reply);
  saveStore(store);
}

export function listPendingReplies(): PendingReply[] {
  return loadStore().replies;
}

export function getPendingReply(id: string): PendingReply | null {
  const store = loadStore();
  return store.replies.find(reply => reply.id === id) || null;
}

export function updatePendingReply(
  id: string,
  updates: Partial<Pick<PendingReply, 'status' | 'note'>>
): PendingReply | null {
  const store = loadStore();
  const target = store.replies.find(reply => reply.id === id);
  if (!target) return null;

  if (updates.status) {
    target.status = updates.status;
  }
  if (updates.note !== undefined) {
    target.note = updates.note;
  }

  saveStore(store);
  return target;
}

export function deletePendingReply(id: string): PendingReply | null {
  const store = loadStore();
  const index = store.replies.findIndex(reply => reply.id === id);
  if (index === -1) return null;

  const [removed] = store.replies.splice(index, 1);
  saveStore(store);
  return removed;
}

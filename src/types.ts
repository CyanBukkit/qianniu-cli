export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Buyer {
  id: string;
  name: string;
  x: number;
  y: number;
}

export type ChatSenderRole = 'buyer' | 'seller' | 'unknown';

export interface ParsedChatMessage {
  senderName: string;
  senderRole: ChatSenderRole;
  timestamp: string;
  content: string;
  read: boolean;
}

export interface ChatFingerprint {
  buyerName: string;
  sellerName: string;
  messageCount: number;
  lastMessageAt: string;
  lastBuyerMessage: string;
  tailSignature: string;
}

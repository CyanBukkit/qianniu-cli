import { createHash } from 'crypto';
import { ChatFingerprint, ParsedChatMessage } from '../types';
import { SELLER_NAME } from './constants';

const MESSAGE_HEADER_RE = /^(.+?)(\d{4}-\d{1,2}-\d{1,2} \d{2}:\d{2}:\d{2})$/;
const READ_MARKER = '已读';

function normalizeContent(lines: string[]): string {
  return lines
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    .trim();
}

function inferBuyerName(messages: ParsedChatMessage[], sellerName: string): string {
  const buyer = messages.find(message => message.senderName !== sellerName);
  return buyer?.senderName || 'unknown-buyer';
}

export function parseChatTranscript(rawText: string, sellerName = SELLER_NAME): ParsedChatMessage[] {
  const lines = rawText.split('\n');
  const messages: ParsedChatMessage[] = [];

  let currentSenderName = '';
  let currentTimestamp = '';
  let currentContentLines: string[] = [];
  let awaitingReadMarker = false;

  const flushCurrent = (read: boolean): void => {
    if (!currentSenderName || !currentTimestamp) return;
    messages.push({
      senderName: currentSenderName,
      senderRole: currentSenderName === sellerName ? 'seller' : 'buyer',
      timestamp: currentTimestamp,
      content: normalizeContent(currentContentLines),
      read,
    });
    currentSenderName = '';
    currentTimestamp = '';
    currentContentLines = [];
    awaitingReadMarker = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const headerMatch = line.match(MESSAGE_HEADER_RE);

    if (headerMatch) {
      flushCurrent(awaitingReadMarker);
      currentSenderName = headerMatch[1].trim();
      currentTimestamp = headerMatch[2].trim();
      currentContentLines = [];
      awaitingReadMarker = true;
      continue;
    }

    if (line.trim() === READ_MARKER) {
      flushCurrent(true);
      continue;
    }

    if (currentSenderName) {
      currentContentLines.push(line);
    }
  }

  flushCurrent(false);
  return messages;
}

export function buildChatFingerprint(
  messages: ParsedChatMessage[],
  sellerName = SELLER_NAME
): ChatFingerprint {
  const buyerName = inferBuyerName(messages, sellerName);
  const lastMessage = messages[messages.length - 1];
  const lastBuyerMessage = [...messages]
    .reverse()
    .find(message => message.senderRole === 'buyer' && message.content)?.content || '';
  const tail = messages.slice(-3).map(message =>
    `${message.senderName}|${message.timestamp}|${message.content.replace(/\s+/g, ' ').slice(0, 120)}`
  );
  const tailSignature = createHash('sha1').update(tail.join('\n')).digest('hex').slice(0, 16);

  return {
    buyerName,
    sellerName,
    messageCount: messages.length,
    lastMessageAt: lastMessage?.timestamp || '',
    lastBuyerMessage,
    tailSignature,
  };
}

export function extractRecentBuyerMessages(messages: ParsedChatMessage[], limit = 3): ParsedChatMessage[] {
  return messages
    .filter(message => message.senderRole === 'buyer' && message.content)
    .slice(-limit);
}

export function formatMessagesForPrompt(messages: ParsedChatMessage[]): string {
  return messages
    .map(message => `[${message.timestamp}] ${message.senderRole === 'seller' ? '卖家' : '买家'}(${message.senderName}): ${message.content || '(空消息)'}`)
    .join('\n');
}

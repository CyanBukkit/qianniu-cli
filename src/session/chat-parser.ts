import { createHash } from 'crypto';
import { ChatFingerprint, ParsedChatMessage } from '../types';
import { SELLER_NAME } from './constants';

const MESSAGE_HEADER_RE = /^(.+?)(\d{4}-\d{1,2}-\d{1,2} \d{2}:\d{2}:\d{2})$/;
const READ_MARKER = '已读';
const UI_NOISE_KEYWORDS = [
  '推荐回复',
  '发送引用',
  '还有什么可以帮您的吗',
  '立即下单',
  '销量已售',
  '原价',
  'UP主运营专做',
];

function isUiNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return UI_NOISE_KEYWORDS.some(keyword => trimmed.includes(keyword));
}

function normalizeContent(lines: string[]): string {
  return lines
    .map(line => line.trim())
    // 千牛会把推荐回复、商品卡片等界面文案一起复制出来，需要在解析层剔除。
    .filter(line => line.length > 0 && !isUiNoiseLine(line))
    .join('\n')
    .trim();
}

function getCommonSuffixLength(a: string, b: string): number {
  let length = 0;
  let aIndex = a.length - 1;
  let bIndex = b.length - 1;

  while (aIndex >= 0 && bIndex >= 0 && a[aIndex] === b[bIndex]) {
    length += 1;
    aIndex -= 1;
    bIndex -= 1;
  }

  return length;
}

function isSellerSenderName(senderName: string, sellerName: string): boolean {
  const normalizedSender = senderName.trim();
  const normalizedSeller = sellerName.trim();
  if (!normalizedSender || !normalizedSeller) return false;

  const commonSuffixLength = getCommonSuffixLength(normalizedSender, normalizedSeller);
  return normalizedSender === normalizedSeller
    || normalizedSeller.includes(normalizedSender)
    || normalizedSender.includes(normalizedSeller)
    || commonSuffixLength >= 4;
}

function normalizeSenderName(senderName: string, sellerName: string): string {
  return isSellerSenderName(senderName, sellerName)
    ? sellerName
    : senderName.trim();
}

function inferBuyerName(messages: ParsedChatMessage[], sellerName: string): string {
  const buyer = [...messages]
    .reverse()
    .find(message => !isSellerSenderName(message.senderName, sellerName));
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
    const normalizedSenderName = normalizeSenderName(currentSenderName, sellerName);
    messages.push({
      senderName: normalizedSenderName,
      senderRole: isSellerSenderName(normalizedSenderName, sellerName) ? 'seller' : 'buyer',
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

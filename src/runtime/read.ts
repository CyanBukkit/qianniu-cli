import { execSync } from 'child_process';
import * as fs from 'fs';
import { screenshot, recognizeText } from '../clipboard';
import { buildChatFingerprint, parseChatTranscript } from '../session';
import { Buyer } from '../types';
import { appendAuditLog } from './audit-log';
import {
  ALIWORKBENCH,
  RECEPTION,
  clickAt,
  getChatWindowPosition,
  getReceptionWindowRect,
  loadCalibrateConfig,
  runScript,
} from './window';

interface RawBuyerElement {
  name: string;
  role: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const BUYER_LIST_IGNORED_EXACT = new Set([
  '联系人',
  '订单号、聊天记录',
  '在线',
  '辅助中',
  '全部买家',
  '全部消息',
  '其他消息',
  '正在接待',
  '展开',
  '智能客服全新升级，助力客服高效接待！',
  '操作指南',
  '智能客服',
]);

const BUYER_LIST_IGNORED_KEYWORDS = [
  '工作台',
  '消息',
  '进店',
  '工单',
  '离线消息',
  '打单工具',
  '客服',
  '辅助中',
  '在线',
  '展开',
  '设置',
  '邀请',
  '发送',
  '商品',
  '订单',
  '足迹',
  '推荐',
  '历史订单',
  '近3个月订单',
  '列表分组',
  '最后一句消息',
  '未下单',
  '未付款',
  '已付款',
  '今日接待',
];

function parseBuyerElements(result: string): RawBuyerElement[] {
  return result
    .split(';;;;')
    .filter(Boolean)
    .map(segment => {
      const [name, role, pos, size] = segment.split('|||');
      const [x, y] = (pos || '').split(',').map(value => Number(value.trim()));
      const [w, h] = (size || '').split(',').map(value => Number(value.trim()));
      return {
        name: (name || '').trim(),
        role: (role || '').trim(),
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        w: Number.isFinite(w) ? w : 0,
        h: Number.isFinite(h) ? h : 0,
      };
    })
    .filter(element => element.name);
}

function looksLikeBuyerName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (BUYER_LIST_IGNORED_EXACT.has(trimmed)) return false;
  if (BUYER_LIST_IGNORED_KEYWORDS.some(keyword => trimmed.includes(keyword))) return false;
  if (trimmed.length > 40) return false;
  if (!/[\u4e00-\u9fa5A-Za-z0-9_]/.test(trimmed)) return false;
  return true;
}

function dedupeBuyers(elements: RawBuyerElement[]): Buyer[] {
  const buyers = new Map<string, Buyer>();

  for (const element of elements.sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (!looksLikeBuyerName(element.name)) continue;
    if (buyers.has(element.name)) continue;

    buyers.set(element.name, {
      id: element.name,
      name: element.name,
      x: Math.round(element.x + Math.max(18, Math.min(element.w / 2, 80))),
      y: Math.round(element.y + Math.max(10, Math.min(element.h / 2, 22))),
    });
  }

  return Array.from(buyers.values());
}

export function scanBuyerList(): Buyer[] {
  const receptionRect = getReceptionWindowRect() || RECEPTION;
  const minX = receptionRect.x + 55;
  const maxX = receptionRect.x + Math.min(340, receptionRect.w * 0.3);
  const minY = receptionRect.y + 90;
  const maxY = receptionRect.y + receptionRect.h - 20;

  const script = `
    tell application "System Events"
      tell process "${ALIWORKBENCH}"
        set targetWindow to missing value
        repeat with i from 1 to count of windows
          try
            set w to window i
            if name of w contains "接待中心" then
              set targetWindow to w
              exit repeat
            end if
          end try
        end repeat

        if targetWindow is missing value then
          return ""
        end if

        set out to ""
        try
          set candidates to entire contents of group 1 of targetWindow
        on error
          set candidates to entire contents of targetWindow
        end try

        repeat with elem in candidates
          try
            set nm to name of elem
            if nm is missing value then
              set nm to ""
            end if
            set rl to role description of elem
            set pos to position of elem
            set sz to size of elem
            set out to out & nm & "|||" & rl & "|||" & (item 1 of pos) & "," & (item 2 of pos) & "|||" & (item 1 of sz) & "," & (item 2 of sz) & ";;;;"
          end try
        end repeat

        return out
      end tell
    end tell
  `;

  try {
    const elements = parseBuyerElements(runScript(script)).filter(element => {
      if (element.x < minX || element.x > maxX) return false;
      if (element.y < minY || element.y > maxY) return false;
      if (element.w < 20 || element.h < 12) return false;
      return true;
    });
    return dedupeBuyers(elements);
  } catch (error) {
    appendAuditLog('buyer-list-scan-failed', {
      error: String(error),
    }, 'warn');
    return [];
  }
}

export function openChatByBuyerName(buyerName: string): boolean {
  const buyers = scanBuyerList();
  const exactMatch = buyers.find(buyer => buyer.name === buyerName);
  const fuzzyMatch = exactMatch
    || buyers.find(buyer => buyer.name.startsWith(buyerName) || buyerName.startsWith(buyer.name))
    || buyers.find(buyer => buyer.name.includes(buyerName) || buyerName.includes(buyer.name));
  if (!fuzzyMatch) {
    appendAuditLog('buyer-open-miss', {
      buyerName,
      visibleBuyers: buyers.map(buyer => buyer.name),
    }, 'warn');
    return false;
  }

  appendAuditLog('buyer-open-click', {
    buyerName,
    matchedBuyerName: fuzzyMatch.name,
    x: fuzzyMatch.x,
    y: fuzzyMatch.y,
  });
  clickAt(fuzzyMatch.x, fuzzyMatch.y);
  execSync('sleep 0.8');
  return true;
}

export function openChat(buyer: Buyer): boolean {
  return openChatByBuyerName(buyer.name);
}

export async function readMessages(): Promise<string[]> {
  const chatPath = '/tmp/qianniu-chat.png';

  let chatX: number;
  let chatY: number;
  let chatW = 900;
  let chatH = 500;

  const calibrate = loadCalibrateConfig();
  if (calibrate) {
    chatX = calibrate.x;
    chatY = calibrate.y;
    chatW = calibrate.w;
    chatH = calibrate.h;
    console.log(`📍 使用标定坐标: (${chatX}, ${chatY}) ${chatW}x${chatH}`);
  } else {
    const windowPos = getChatWindowPosition();
    if (windowPos) {
      chatX = windowPos.x;
      chatY = windowPos.y;
      chatW = windowPos.w;
      chatH = windowPos.h;
    } else {
      const receptionRect = getReceptionWindowRect();
      if (receptionRect) {
        chatX = receptionRect.x + 260;
        chatY = receptionRect.y + 50;
        chatW = Math.max(receptionRect.w - 320, 600);
        chatH = Math.max(receptionRect.h - 160, 300);
        console.log(`📍 使用接待中心窗口推导坐标: (${chatX}, ${chatY}) ${chatW}x${chatH}`);
      } else {
        chatX = RECEPTION.x + 260;
        chatY = RECEPTION.y + 50;
        console.log(`📍 使用默认坐标: (${chatX}, ${chatY})`);
      }
    }
  }

  screenshot(chatX, chatY, chatW, chatH, chatPath);
  const text = await recognizeText(chatPath);

  try {
    fs.unlinkSync(chatPath);
  } catch {
    // 剪贴板模式下没有实际截图文件，这里保持兼容即可。
  }

  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 1 && !line.match(/^(ERROR|OCR)/));
}

export async function readChatTranscript(): Promise<string> {
  const messages = await readMessages();
  return messages.join('\n');
}

export async function readParsedChat() {
  const transcript = await readChatTranscript();
  const parsedMessages = parseChatTranscript(transcript);
  const fingerprint = buildChatFingerprint(parsedMessages);
  return {
    transcript,
    parsedMessages,
    fingerprint,
  };
}

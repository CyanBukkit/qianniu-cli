/**
 * 剪贴板拦截模块
 * 通过全选复制获取聊天内容（替代旧 OCR 方案）
 */

import { execSync } from 'child_process';
import { appendAuditLog } from './runtime/audit-log';
import { activateApp, ALIWORKBENCH, clickAt, loadRecordedPoint, runScript } from './runtime/window';

// ============ 拦截聊天内容 =================

const CHAT_HEADER_RE = /^.+\d{4}-\d{1,2}-\d{1,2} \d{2}:\d{2}:\d{2}$/gm;
const CHAT_CLIPBOARD_RETRY_LIMIT = 3;
const CLIPBOARD_POLLUTION_MARKERS = [
  '服务态度@fixed',
  '/qianniu-automation/data/',
];

function isClipboardPolluted(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('/Users/')
    || CLIPBOARD_POLLUTION_MARKERS.some(marker => trimmed.includes(marker));
}

function looksLikeChatTranscript(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || isClipboardPolluted(trimmed)) {
    return false;
  }

  const headerMatches = trimmed.match(CHAT_HEADER_RE) || [];
  return headerMatches.length >= 2 || (headerMatches.length >= 1 && trimmed.includes('已读'));
}

function releaseChatSelection(chatAreaPoint: { x: number; y: number }): void {
  clickAt(chatAreaPoint.x, chatAreaPoint.y);
  execSync('sleep 0.2');
}

/**
 * 拦截聊天区域内容
 * 流程：点击 → 全选 → 复制 → 读取剪贴板 → 再点击结束选中
 * @returns 聊天内容（后500字）
 */
export function interceptChatContent(): string {
  try {
    // 统一复用 runtime/window 的定位逻辑，避免旧实现点到错误窗口。
    const chatAreaPoint = loadRecordedPoint('聊天记录');
    if (!chatAreaPoint) {
      console.log('⚠️ 未找到"聊天记录"坐标');
      appendAuditLog('chat-intercept-miss', {
        pointName: '聊天记录',
      }, 'warn');
      return '';
    }

    activateApp(ALIWORKBENCH);
    execSync('sleep 0.2');

    console.log(`  📍 聊天记录: (${chatAreaPoint.x}, ${chatAreaPoint.y})`);
    console.log(`  📋 拦截聊天内容...`);
    for (let attempt = 1; attempt <= CHAT_CLIPBOARD_RETRY_LIMIT; attempt += 1) {
      appendAuditLog('chat-intercept-focus', {
        pointName: '聊天记录',
        x: chatAreaPoint.x,
        y: chatAreaPoint.y,
        attempt,
      });
      clickAt(chatAreaPoint.x, chatAreaPoint.y);
      execSync('sleep 0.3');

      // 先清空剪贴板，避免复制失败时继续吃到上一次脏内容。
      execSync(`printf '' | pbcopy`, { encoding: 'utf8' });
      execSync('sleep 0.1');

      runScript(`tell application "System Events" to keystroke "a" using command down`);
      execSync('sleep 0.2');

      runScript(`tell application "System Events" to keystroke "c" using command down`);
      execSync('sleep 0.3');

      const clipboard = execSync('pbpaste', { encoding: 'utf8' }).trim();
      appendAuditLog('chat-intercept-copied', {
        attempt,
        length: clipboard.length,
        preview: clipboard.slice(0, 300),
      });
      releaseChatSelection(chatAreaPoint);

      if (looksLikeChatTranscript(clipboard)) {
        console.log(`  📋 内容 (${clipboard.length}字)`);
        // 直接返回完整聊天，避免按字符截断后把消息头切断，导致买卖家识别串位。
        return clipboard;
      }

      appendAuditLog('chat-intercept-invalid', {
        attempt,
        length: clipboard.length,
        preview: clipboard.slice(0, 300),
        reason: clipboard.trim() ? 'clipboard-not-chat-transcript' : 'clipboard-empty',
      }, 'warn');
      execSync('sleep 0.4');
    }

    appendAuditLog('chat-intercept-invalid', {
      attempts: CHAT_CLIPBOARD_RETRY_LIMIT,
      reason: 'retry-limit-exceeded',
    }, 'warn');
    return '';
  } catch (e) {
    console.error('拦截聊天内容失败:', e);
    appendAuditLog('chat-intercept-failed', {
      error: String(e),
    }, 'error');
    return '';
  }
}

/**
 * 读取剪贴板内容（纯函数）
 */
export function getClipboard(): string {
  try {
    return execSync('pbpaste', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// ============ 兼容旧 OCR 接口 =================

/**
 * 兼容旧接口 - 旧代码调用这个
 * 现在直接拦截剪贴板内容
 */
export async function recognizeText(imagePath: string): Promise<string> {
  return interceptChatContent();
}

/**
 * 兼容旧接口
 */
export function screenshot(x: number, y: number, w: number, h: number, outputPath = '/tmp/qianniu-ocr-temp.png'): void {
  // 不再需要截图，保留空实现
}

/**
 * 兼容旧接口
 */
export function screenshotChat(): string {
  return '/tmp/qianniu-ocr-temp.png';
}

/**
 * 兼容旧接口
 */
export function detectChanges(oldText: string, newText: string): string[] {
  const oldLines = oldText.split('\n').map((l: string) => l.trim()).filter(Boolean);
  const newLines = newText.split('\n').map((l: string) => l.trim()).filter(Boolean);

  const newMessages: string[] = [];
  for (const line of newLines) {
    if (!oldLines.includes(line) && line.length > 2) {
      newMessages.push(line);
    }
  }
  return newMessages;
}

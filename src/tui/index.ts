import * as readline from 'readline';
import { listPendingReplies } from '../session';
import {
  getAutoReplyEnabled,
  monitorCycle,
  setAutoReplyEnabled,
  stopMonitor,
} from '../runtime/monitor';
import { getRuntimeState, appendRuntimeLog } from '../runtime/state';

const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';

function padLine(line: string, width: number): string {
  const visible = line.replace(/\x1b\[[0-9;]*m/g, '');
  if (visible.length >= width) {
    return visible.slice(0, Math.max(0, width - 1));
  }
  return line + ' '.repeat(width - visible.length);
}

function truncate(line: string, width: number): string {
  if (width <= 0) return '';
  const plain = line.replace(/\s+/g, ' ').trim();
  if (plain.length <= width) {
    return plain;
  }
  if (width <= 1) {
    return plain.slice(0, width);
  }
  return `${plain.slice(0, width - 1)}…`;
}

function color(text: string, code: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

function statusTone(value: boolean, yesText: string, noText: string): string {
  return value ? color(yesText, '32') : color(noText, '33');
}

function formatTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function drawBox(title: string, lines: string[], width: number): string[] {
  const horizontal = '─'.repeat(Math.max(0, width - 2));
  const output = [`┌${horizontal}┐`];
  const header = ` ${title} `;
  output.push(`│${padLine(header, width - 2)}│`);
  output.push(`├${horizontal}┤`);

  const bodyHeight = Math.max(0, lines.length);
  for (let i = 0; i < bodyHeight; i++) {
    output.push(`│${padLine(lines[i], width - 2)}│`);
  }

  output.push(`└${horizontal}┘`);
  return output;
}

function renderTui(): void {
  const runtime = getRuntimeState();
  const pendingReplies = listPendingReplies().slice(0, 5);
  const width = Math.max(process.stdout.columns || 100, 80);
  const height = Math.max(process.stdout.rows || 28, 24);
  const innerWidth = width - 4;
  const topWidth = Math.max(38, Math.floor((innerWidth - 2) / 2));
  const rightWidth = innerWidth - topWidth - 2;

  const leftLines = [
    `监控: ${statusTone(runtime.isRunning, '运行中', '已停止')}`,
    `自动回复: ${statusTone(runtime.autoReplyEnabled, '已启用', '已禁用')}`,
    `阶段: ${runtime.phase || '-'}`,
    `轮询次数: ${runtime.loopCount}`,
    `轮询间隔: ${runtime.intervalMs} ms`,
    `最近轮询: ${formatTime(runtime.lastPollAt)}`,
    `当前买家: ${runtime.currentSession.buyerName || '-'}`,
    `会话签名: ${runtime.currentSession.tailSignature || '-'}`,
    `解析消息数: ${runtime.currentSession.parsedMessageCount}`,
    `挂起回复数: ${runtime.pendingReplyCount}`,
    `最后错误: ${truncate(runtime.lastError || '-', topWidth - 14)}`,
    '',
    '快捷键',
    '[a] 开关自动回复',
    '[r] 立即刷新',
    '[q] 退出 TUI',
  ];

  const rightLines = [
    `状态: ${runtime.currentSession.status || '-'}`,
    `最后消息时间: ${runtime.currentSession.lastMessageAt || '-'}`,
    '',
    '聊天预览',
    ...((runtime.currentSession.transcriptPreview || '(暂无)').split('\n').slice(0, 8)
      .map(line => truncate(line, rightWidth - 4))),
    '',
    '买家重点消息',
    ...(runtime.currentSession.buyerMessagesPreview.length > 0
      ? runtime.currentSession.buyerMessagesPreview.slice(0, 3).map(line => truncate(line, rightWidth - 4))
      : ['(暂无)']),
    '',
    '最近 AI 草稿',
    truncate(runtime.currentSession.lastAIReply || '(暂无)', rightWidth - 4),
  ];

  const pendingLines = pendingReplies.length > 0
    ? pendingReplies.flatMap(reply => ([
        truncate(`[${reply.status}] ${reply.buyerName} ${reply.createdAt}`, innerWidth - 4),
        truncate(`原因: ${reply.reason}`, innerWidth - 4),
        truncate(`草稿: ${reply.draft}`, innerWidth - 4),
        '',
      ]))
    : ['当前没有挂起回复'];

  const logLines = runtime.logs.slice(0, Math.max(4, height - 34)).map(log => {
    const levelColor = log.level === 'error'
      ? '31'
      : log.level === 'warn'
        ? '33'
        : '36';
    return truncate(`${color(log.level.toUpperCase(), levelColor)} ${formatTime(log.at)} ${log.message}`, innerWidth - 4);
  });

  const content: string[] = [];
  content.push(color('千牛 CLI TUI', '1;37'));
  content.push(color('围绕当前 AppleScript + 模拟点击链路的实时终端面板', '2;37'));
  content.push('');

  const leftBox = drawBox('运行状态', leftLines, topWidth);
  const rightBox = drawBox('当前会话', rightLines, rightWidth);
  const rowHeight = Math.max(leftBox.length, rightBox.length);

  for (let i = 0; i < rowHeight; i++) {
    const left = leftBox[i] || padLine('', topWidth);
    const right = rightBox[i] || padLine('', rightWidth);
    content.push(`${left}  ${right}`);
  }

  content.push('');
  content.push(...drawBox('挂起回复', pendingLines.slice(0, 12), width - 2));
  content.push('');
  content.push(...drawBox('事件日志', logLines.length > 0 ? logLines : ['暂无日志'], width - 2));

  const limited = content.slice(0, height - 1);
  process.stdout.write(CLEAR_SCREEN + limited.join('\n'));
}

function installConsoleCapture(): () => void {
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    appendRuntimeLog(args.map(arg => String(arg)).join(' '), 'info');
  };

  console.error = (...args: unknown[]) => {
    appendRuntimeLog(args.map(arg => String(arg)).join(' '), 'error');
  };

  return () => {
    console.log = originalLog;
    console.error = originalError;
  };
}

export async function startTui(intervalMs = 5000): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log('当前环境不是 TTY，回退到普通 monitor 模式');
    await monitorCycle(intervalMs);
    return;
  }

  const restoreConsole = installConsoleCapture();
  process.stdout.write(ALT_SCREEN_ON + HIDE_CURSOR);
  appendRuntimeLog('TUI 已启动');

  let closed = false;
  let refreshTimer: NodeJS.Timeout | null = null;

  const cleanup = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    stopMonitor();
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.removeListener('keypress', onKeypress);
    restoreConsole();
    process.stdout.write(SHOW_CURSOR + ALT_SCREEN_OFF);
  };

  const onKeypress = async (_str: string, key: readline.Key) => {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      await cleanup();
      process.exit(0);
      return;
    }

    if (key.name === 'a') {
      const next = !getAutoReplyEnabled();
      setAutoReplyEnabled(next);
      appendRuntimeLog(`自动回复已切换为: ${next ? '启用' : '禁用'}`);
      renderTui();
      return;
    }

    if (key.name === 'r') {
      appendRuntimeLog('手动刷新 TUI');
      renderTui();
    }
  };

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', onKeypress);

  refreshTimer = setInterval(() => {
    renderTui();
  }, 800);

  renderTui();

  try {
    await monitorCycle(intervalMs);
  } finally {
    await cleanup();
  }
}

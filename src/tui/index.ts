import blessed from 'blessed';
import { execSync } from 'child_process';
import {
  deletePendingReply,
  getPendingReply,
  listPendingReplies,
  PendingReply,
} from '../session';
import {
  getAutoReplyEnabled,
  monitorCycle,
  setAutoReplyEnabled,
  stopMonitor,
} from '../runtime/monitor';
import { appendRuntimeLog, getRuntimeState } from '../runtime/state';

type ViewMode = 'main' | 'pending-detail';

function formatTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

function copyToClipboard(text: string): boolean {
  try {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
    execSync(`printf "%s" "${escaped}" | pbcopy`, { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

function buildPendingListItems(replies: PendingReply[]): string[] {
  if (replies.length === 0) {
    return ['暂无挂起回复'];
  }

  return replies.map(reply => {
    const status = reply.status.toUpperCase();
    return `${status} · ${reply.buyerName}`;
  });
}

export async function startTui(intervalMs = 5000): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log('当前环境不是 TTY，回退到普通 monitor 模式');
    await monitorCycle(intervalMs);
    return;
  }

  const restoreConsole = installConsoleCapture();

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'Qianniu CLI',
    dockBorders: false,
  });

  let closed = false;
  let refreshTimer: NodeJS.Timeout | null = null;
  let viewMode: ViewMode = 'main';
  let selectedPendingId = '';
  let selectedPendingIndex = 0;

  const root = blessed.box({
    parent: screen,
    width: '100%',
    height: '100%',
    style: {
      bg: 'white',
      fg: 'blue',
    },
  });

  const header = blessed.box({
    parent: root,
    top: 0,
    left: 0,
    width: '100%',
    height: 2,
    tags: true,
    padding: { left: 1, right: 1 },
    style: {
      bg: 'blue',
      fg: 'white',
    },
  });

  const footer = blessed.box({
    parent: root,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    padding: { left: 1, right: 1 },
    style: {
      bg: 'blue',
      fg: 'white',
    },
  });

  const summaryBox = blessed.box({
    parent: root,
    top: 2,
    left: 0,
    width: '34%',
    height: 8,
    label: ' 概览 ',
    tags: true,
    border: { type: 'line' },
    padding: { left: 1, right: 1 },
    style: {
      fg: 'blue',
      border: { fg: 'blue' },
      label: { fg: 'blue', bold: true },
    },
  });

  const sessionBox = blessed.box({
    parent: root,
    top: 2,
    left: '34%',
    width: '66%',
    height: 8,
    label: ' 当前会话 ',
    tags: true,
    border: { type: 'line' },
    padding: { left: 1, right: 1 },
    style: {
      fg: 'blue',
      border: { fg: 'blue' },
      label: { fg: 'blue', bold: true },
    },
  });

  const pendingList = blessed.list({
    parent: root,
    top: 10,
    left: 0,
    width: '38%',
    bottom: 1,
    label: ' 挂起回复 ',
    tags: true,
    border: { type: 'line' },
    keys: true,
    vi: true,
    mouse: true,
    padding: { left: 1, right: 1 },
    style: {
      fg: 'blue',
      border: { fg: 'blue' },
      selected: {
        bg: 'blue',
        fg: 'white',
        bold: true,
      },
      item: {
        hover: {
          bg: 'blue',
          fg: 'white',
        },
      },
    },
    scrollbar: {
      ch: ' ',
      track: {
        bg: 'white',
      },
      style: {
        bg: 'blue',
      },
    },
  });

  const pendingHint = blessed.box({
    parent: root,
    top: 10,
    left: '38%',
    width: '62%',
    bottom: 1,
    label: ' 说明 ',
    tags: true,
    border: { type: 'line' },
    padding: { left: 1, right: 1 },
    style: {
      fg: 'blue',
      border: { fg: 'blue' },
    },
  });

  const detailPage = blessed.box({
    parent: root,
    top: 2,
    left: 0,
    width: '100%',
    bottom: 1,
    hidden: true,
    style: {
      bg: 'white',
      fg: 'blue',
    },
  });

  const detailHeader = blessed.box({
    parent: detailPage,
    top: 0,
    left: 0,
    width: '100%',
    height: 2,
    tags: true,
    padding: { left: 1, right: 1 },
    style: {
      bg: 'blue',
      fg: 'white',
    },
  });

  const detailBody = blessed.box({
    parent: detailPage,
    top: 2,
    left: 0,
    width: '100%',
    bottom: 2,
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    border: { type: 'line' },
    padding: { left: 1, right: 1 },
    style: {
      fg: 'blue',
      border: { fg: 'blue' },
    },
    scrollbar: {
      ch: ' ',
      track: {
        bg: 'white',
      },
      style: {
        bg: 'blue',
      },
    },
  });

  const detailFooter = blessed.box({
    parent: detailPage,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 2,
    tags: true,
    padding: { left: 1, right: 1 },
    style: {
      bg: 'blue',
      fg: 'white',
    },
  });

  function showFlash(message: string): void {
    footer.setContent(` ${message}`);
    screen.render();
  }

  function renderMainView(): void {
    const runtime = getRuntimeState();
    const pendingReplies = listPendingReplies();

    header.setContent([
      `{bold}QIANNIU{/bold}  ${runtime.isRunning ? '[RUN]' : '[STOP]'}  ${runtime.autoReplyEnabled ? '[AUTO]' : '[MANUAL]'}  [${runtime.phase || 'idle'}]  买家 ${runtime.currentSession.buyerName || '-'}  挂起 ${runtime.pendingReplyCount}  最近 ${formatTime(runtime.lastPollAt)}`,
    ].join('\n'));

    summaryBox.setContent([
      `监控 ${runtime.isRunning ? '运行中' : '已停止'}`,
      `任务 ${runtime.autoReplyEnabled ? '运行中' : '已暂停'}`,
      `阶段 ${runtime.phase || '-'}`,
      `轮询 ${runtime.loopCount}`,
      `间隔 ${runtime.intervalMs} ms`,
      `买家 ${runtime.buyers.length}`,
      `挂起 ${runtime.pendingReplyCount}`,
      `按键 a暂停  ↑↓选择  Enter查看  q返回`,
    ].join('\n'));

    sessionBox.setContent([
      `状态 ${runtime.currentSession.status || '-'}`,
      `动作 ${runtime.currentSession.statusNote || '-'}`,
      `签名 ${runtime.currentSession.tailSignature || '-'}`,
      `最后消息 ${runtime.currentSession.lastMessageAt || '-'}`,
      `${runtime.currentSession.transcriptPreview || '(暂无聊天内容)'}`,
      `${runtime.currentSession.lastAIReply || '(暂无)'}`,
    ].join('\n'));

    pendingList.setItems(buildPendingListItems(pendingReplies));
    if (pendingReplies.length > 0) {
      const nextIndex = Math.max(0, pendingReplies.findIndex(reply => reply.id === selectedPendingId));
      const safeIndex = nextIndex === -1 ? 0 : nextIndex;
      selectedPendingIndex = safeIndex;
      pendingList.select(safeIndex);
      selectedPendingId = pendingReplies[safeIndex]?.id || '';
    } else {
      selectedPendingId = '';
      selectedPendingIndex = 0;
      pendingList.select(0);
    }

    const selected = pendingReplies.find(reply => reply.id === selectedPendingId) || null;
    pendingHint.setContent(selected
      ? [
          `选中 ${selected.buyerName}`,
          `状态 ${selected.status}`,
          '',
          `这是未发布给客户的消息`,
          `按 Enter 打开详情页`,
          `详情页可查看 AI 草稿和原始会话`,
          '',
          `原因`,
          `${selected.reason}`,
        ].join('\n')
      : '当前没有挂起回复\n\n当 AI 回复因为会话切换或校验失败未发送时，会出现在这里。\n选中后按 Enter 查看。');

    detailPage.hide();
    pendingList.show();
    pendingHint.show();
    screen.render();
  }

  function renderDetailView(reply: PendingReply): void {
    const detail = getPendingReply(reply.id) || reply;
    detailHeader.setContent([
      `{bold}PENDING{/bold}  ${detail.buyerName}  状态 ${detail.status}  创建 ${formatTime(detail.createdAt)}`,
    ].join('\n'));

    detailBody.setContent([
      `{bold}原因{/bold}`,
      detail.reason,
      '',
      `{bold}AI 草稿{/bold}`,
      detail.draft || '(暂无)',
      '',
      `{bold}原始会话{/bold}`,
      detail.originalTranscript || '(无原文)',
    ].join('\n'));

    detailFooter.setContent(' q 返回   c 复制AI草稿   d 删除未发布消息 ');

    detailPage.show();
    pendingList.hide();
    pendingHint.hide();
    detailBody.focus();
    screen.render();
  }

  function openSelectedPending(): void {
    const pendingReplies = listPendingReplies();
    if (pendingReplies.length === 0) {
      showFlash('当前没有挂起回复');
      return;
    }

    const selected = pendingReplies[selectedPendingIndex] || pendingReplies[0];
    if (!selected) return;
    selectedPendingId = selected.id;
    viewMode = 'pending-detail';
    renderDetailView(selected);
  }

  async function cleanup(): Promise<void> {
    if (closed) return;
    closed = true;
    stopMonitor();
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    restoreConsole();
    screen.destroy();
  }

  pendingList.key(['enter'], () => {
    openSelectedPending();
  });

  pendingList.on('select', (_, index) => {
    const replies = listPendingReplies();
    selectedPendingIndex = index;
    const selected = replies[index];
    if (selected) {
      selectedPendingId = selected.id;
      renderMainView();
    }
  });

  screen.key(['a'], () => {
    const next = !getAutoReplyEnabled();
    setAutoReplyEnabled(next);
    appendRuntimeLog(`任务已${next ? '恢复' : '暂停'}`);
    showFlash(`任务已${next ? '恢复' : '暂停'}`);
    renderMainView();
  });

  screen.key(['q', 'C-c'], async () => {
    if (viewMode === 'pending-detail') {
      viewMode = 'main';
      detailPage.hide();
      pendingList.show();
      pendingHint.show();
      pendingList.focus();
      renderMainView();
      return;
    }

    await cleanup();
    process.exit(0);
  });

  screen.key(['r'], () => {
    appendRuntimeLog('手动刷新 TUI');
    renderMainView();
  });

  detailBody.key(['q', 'escape'], () => {
    viewMode = 'main';
    detailPage.hide();
    pendingList.show();
    pendingHint.show();
    pendingList.focus();
    renderMainView();
  });

  detailBody.key(['c'], () => {
    const detail = selectedPendingId ? getPendingReply(selectedPendingId) : null;
    if (!detail?.draft) {
      showFlash('没有可复制的AI草稿');
      return;
    }
    const copied = copyToClipboard(detail.draft);
    showFlash(copied ? `已复制AI草稿: ${detail.buyerName}` : '复制失败');
    appendRuntimeLog(copied ? `已复制挂起AI草稿 ${detail.id}` : `复制挂起AI草稿失败 ${detail.id}`, copied ? 'info' : 'error');
  });

  detailBody.key(['d'], () => {
    if (!selectedPendingId) return;
    const removed = deletePendingReply(selectedPendingId);
    if (!removed) {
      showFlash('删除失败');
      return;
    }
    appendRuntimeLog(`已删除挂起回复 ${removed.id}`);
    showFlash(`已删除挂起回复: ${removed.buyerName}`);
    selectedPendingId = '';
    viewMode = 'main';
    detailPage.hide();
    pendingList.show();
    pendingHint.show();
    pendingList.focus();
    renderMainView();
  });

  refreshTimer = setInterval(() => {
    if (viewMode === 'main') {
      renderMainView();
    } else if (selectedPendingId) {
      const detail = getPendingReply(selectedPendingId);
      if (detail) {
        renderDetailView(detail);
      } else {
        viewMode = 'main';
        renderMainView();
      }
    }
  }, 800);

  pendingList.focus();
  renderMainView();

  try {
    await monitorCycle(intervalMs);
  } finally {
    await cleanup();
  }
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

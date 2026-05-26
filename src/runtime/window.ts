import { execSync } from 'child_process';
import * as fs from 'fs';
import { Point, Rect } from '../types';
import { appendAuditLog } from './audit-log';

export const ALIWORKBENCH = 'Aliworkbench';
export const RECEPTION: Rect = { x: 27, y: 38, w: 1310, h: 800 };

interface WindowInfo {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const NEW_CONSULTATION_WINDOW_SUFFIX = '消息提醒';
const NEW_CONSULTATION_BLOCKED_SUFFIXES = ['消息通知'];
const SERVICE_ATTITUDE_WINDOW_KEYWORD = '服务态度提醒';

export function runScript(script: string): string {
  const tmpPath = `/tmp/qianniu-script-${Date.now()}.scpt`;
  fs.writeFileSync(tmpPath, script);
  try {
    return execSync(`osascript ${tmpPath}`, { timeout: 20000, encoding: 'utf8' }).trim();
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

export function activateApp(name: string): void {
  runScript(`tell application "${name}" to activate`);
}

export function activateReception(): void {
  activateApp(ALIWORKBENCH);
  execSync('sleep 0.3');

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
          return "RECEPTION_NOT_FOUND"
        end if

        set frontmost to true
        delay 0.1
        try
          perform action "AXRaise" of targetWindow
        end try
        delay 0.1
        try
          set focused of targetWindow to true
        end try
        return "RECEPTION_FOCUSED"
      end tell
    end tell
  `;

  try {
    const result = runScript(script);
    if (result !== 'RECEPTION_FOCUSED') {
      appendAuditLog('reception-activate', {
        result,
      }, 'warn');
    }
  } catch (error) {
    appendAuditLog('reception-activate-failed', {
      error: String(error),
    }, 'warn');
  }

  execSync('sleep 0.4');
}

export function clickAt(x: number, y: number): void {
  execSync(`cliclick c:${Math.round(x)},${Math.round(y)}`, { timeout: 5000 });
}

function parseWindowList(result: string): WindowInfo[] {
  return result
    .split(';')
    .filter(Boolean)
    .map(seg => {
      const [name, coords] = seg.split('|');
      const parts = (coords || '').split(',').map((s: string) => parseInt(s.trim(), 10));
      return {
        name: name || '',
        x: parts[0] || 0,
        y: parts[1] || 0,
        w: parts[2] || 0,
        h: parts[3] || 0,
      };
    })
    .filter(win => !!win.name);
}

function getAllQianniuWindows(): WindowInfo[] {
  try {
    const script = `
      tell application "System Events"
        tell process "${ALIWORKBENCH}"
          set out to ""
          repeat with i from 1 to count of windows
            try
              set wName to name of window i
              set p to position of window i
              set s to size of window i
              set out to out & wName & "|" & (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s) & ";"
            end try
          end repeat
          return out
        end tell
      end tell
    `;
    return parseWindowList(runScript(script));
  } catch {
    appendAuditLog('window-scan-failed', {}, 'warn');
    return [];
  }
}

function getWindowHints(windowName: string, pointName?: string): string[] {
  const hints = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) hints.add(trimmed);
  };

  ['接待中心', '千牛工作台', '消息提醒', '询问', '单聊'].forEach(keyword => {
    if (windowName.includes(keyword)) add(keyword);
  });

  const suffix = windowName.split('-').pop() || '';
  if (suffix && suffix !== windowName) add(suffix);

  if (pointName === '新的客户咨询') {
    add(NEW_CONSULTATION_WINDOW_SUFFIX);
  }

  return Array.from(hints);
}

function getWindowSuffix(windowName: string): string {
  const segments = windowName.split('-');
  return (segments[segments.length - 1] || windowName).trim();
}

function isBlockedNewConsultationWindow(windowName: string): boolean {
  const suffix = getWindowSuffix(windowName);
  return NEW_CONSULTATION_BLOCKED_SUFFIXES.includes(suffix);
}

function findStrictNewConsultationWindow(windows: WindowInfo[]): WindowInfo | null {
  const exactMatch = windows.find(win => getWindowSuffix(win.name) === NEW_CONSULTATION_WINDOW_SUFFIX) || null;
  if (!exactMatch && windows.some(win => getWindowSuffix(win.name) === '消息通知')) {
    appendAuditLog('new-consultation-window-match', {
      mode: 'blocked-only',
      expectedSuffix: NEW_CONSULTATION_WINDOW_SUFFIX,
      blockedSuffixes: NEW_CONSULTATION_BLOCKED_SUFFIXES,
      windows: windows.map(win => ({
        name: win.name,
        suffix: getWindowSuffix(win.name),
      })),
    }, 'warn');
  }
  return exactMatch;
}

export function getNewConsultationWindowInfo(): Point & { name: string; w: number; h: number } | null {
  const matchedWindow = findStrictNewConsultationWindow(getAllQianniuWindows());
  if (!matchedWindow) return null;
  return matchedWindow;
}

function resolveWindow(windowName: string, windows: WindowInfo[], pointName?: string): WindowInfo | null {
  if (windows.length === 0) return null;

  if (pointName === '新的客户咨询') {
    return findStrictNewConsultationWindow(windows);
  }

  const exact = windows.find(win => win.name === windowName);
  if (exact) {
    return exact;
  }

  const hints = getWindowHints(windowName, pointName);
  const scored = windows
    .map(win => {
      if (pointName === '新的客户咨询' && isBlockedNewConsultationWindow(win.name)) {
        return { win, score: 0, area: win.w * win.h };
      }
      let score = 0;
      for (const hint of hints) {
        if (win.name.includes(hint)) score += hint.length <= 4 ? 100 : 140;
      }
      if (windowName.includes(win.name) || win.name.includes(windowName)) score += 40;
      return { win, score, area: win.w * win.h };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.area - a.area;
    });

  const resolved = scored[0]?.win || null;
  if (!resolved) {
    appendAuditLog('window-resolve', {
      mode: 'miss',
      request: windowName,
      pointName: pointName || '',
      hints,
    }, 'warn');
  }
  return resolved;
}

export function getReceptionWindowRect(): Rect | null {
  const target = resolveWindow('接待中心', getAllQianniuWindows());
  if (!target) return null;
  return { x: target.x, y: target.y, w: target.w, h: target.h };
}

export function getQianniuWindowNames(): string[] {
  try {
    return getAllQianniuWindows().map(win => win.name);
  } catch {
    return [];
  }
}

export function hasServiceAttitudePrompt(): boolean {
  return getQianniuWindowNames().some(name => name.includes(SERVICE_ATTITUDE_WINDOW_KEYWORD));
}

export function resolveServiceAttitudePrompt(): boolean {
  if (!hasServiceAttitudePrompt()) {
    return false;
  }

  const actionPoint = loadRecordedPoint('服务态度');
  if (!actionPoint) {
    appendAuditLog('service-attitude-miss', {
      reason: 'missing-recorded-point',
      pointName: '服务态度',
    }, 'warn');
    return false;
  }

  appendAuditLog('service-attitude-resolve', {
    pointName: '服务态度',
    x: actionPoint.x,
    y: actionPoint.y,
  }, 'warn');
  clickAt(actionPoint.x, actionPoint.y);
  execSync('sleep 0.5');
  return true;
}

export function closeWindowsContainingKeywords(keywords: string[], processName = ALIWORKBENCH): number {
  let closedCount = 0;

  try {
    const script = `
      tell application "System Events"
        tell process "${processName}"
          set winInfo to ""
          repeat with i from 1 to count of windows
            try
              set wName to name of window i
              set winInfo to winInfo & i & "|||" & wName & ";;;;"
            end try
          end repeat
          return winInfo
        end tell
      end tell
    `;
    const result = runScript(script).trim();
    if (!result) return 0;

    const windowList = result.split(';;;;').filter(Boolean).map(seg => {
      const [idx, ...nameParts] = seg.split('|||');
      return {
        index: parseInt(idx.trim(), 10),
        name: nameParts.join('|||').trim(),
      };
    });

    for (const win of windowList) {
      const matchedKeyword = keywords.find(kw => win.name.includes(kw));
      if (!matchedKeyword) continue;

      console.log(`🔍 找到弹窗: "${win.name}" (索引:${win.index})，尝试关闭...`);
      const closeScript = `
        tell application "System Events"
          tell process "${processName}"
            try
              set frontmost to true
              delay 0.1
              set focused of window ${win.index} to true
              keystroke "w" using command down
              return "CLOSED"
            on error errMsg
              return "ERROR: " & errMsg
            end try
          end tell
        end tell
      `;

      try {
        const closeResult = runScript(closeScript).trim();
        if (closeResult === 'CLOSED') {
          console.log(`✅ 已关闭窗口: "${win.name}"`);
          closedCount++;
          execSync('sleep 0.2');
        } else {
          console.log(`⚠️ 关闭结果: ${closeResult}`);
        }
      } catch (e) {
        console.log(`❌ 关闭失败: ${e}`);
      }
    }
  } catch (e) {
    console.log(`❌ 获取窗口列表失败: ${e}`);
  }

  return closedCount;
}

export function closePopupByKey(): boolean {
  try {
    const listScript = `
      tell application "System Events"
        tell process "Aliworkbench"
          set winInfo to ""
          repeat with i from 1 to count of windows
            try
              set wName to name of window i
              set winInfo to winInfo & "[" & i & "] " & wName & ";"
            end try
          end repeat
          return winInfo
        end tell
      end tell
    `;
    const windowList = runScript(listScript).trim();
    console.log(`📋 当前窗口: ${windowList || '(无)'}`);

    const script = `
      tell application "System Events"
        tell process "Aliworkbench"
          repeat with i from 1 to count of windows
            try
              set wName to name of window i
              if wName contains "询问" then
                set frontmost of process "Aliworkbench" to true
                delay 0.1
                perform action "AXRaise" of window i
                delay 0.1
                key code 53
                return "OK"
              end if
            end try
          end repeat
          return "NOT_FOUND"
        end tell
      end tell
    `;

    const result = runScript(script).trim();
    console.log(`🔑 按键结果: ${result}`);
    execSync('sleep 0.3');
    return result === 'OK';
  } catch (e) {
    console.log(`❌ 按键关闭失败: ${e}`);
    return false;
  }
}

export function closePopupByClick(): boolean {
  const closeBtnPoint = loadRecordedPoint('关闭这个消息提醒');
  if (!closeBtnPoint) return false;

  try {
    const x = Math.round(closeBtnPoint.x);
    const y = Math.round(closeBtnPoint.y);
    execSync(`cliclick c:${x},${y}`);
    execSync('sleep 0.2');
    return true;
  } catch {
    return false;
  }
}

export async function closePopups(): Promise<boolean> {
  const popupKeywords = ['消息通知', '询问'];
  const windows = getQianniuWindowNames();

  if (windows.some(w => w.includes('询问'))) {
    console.log('═══════════════════════════════════════');
    console.log('⚠️  检测到"询问"窗口，开始自动关闭尝试...');
    console.log('═══════════════════════════════════════');

    const MAX_TRIES = 10;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      console.log(`\n🔄 尝试关闭 (${attempt}/${MAX_TRIES})...`);

      try {
        const script = `
          tell application "System Events"
            tell process "Aliworkbench"
              set frontmost to true
              delay 0.1
              repeat with i from 1 to count of windows
                try
                  set wName to name of window i
                  if wName contains "询问" then
                    perform action "AXRaise" of window i
                    delay 0.1
                    key code 53
                    delay 0.1
                    key code 36
                    return "DONE"
                  end if
                end try
              end repeat
              return "NOT_FOUND"
            end tell
          end tell
        `;

        const result = runScript(script).trim();
        console.log(`  📋 关闭结果: ${result}`);
      } catch (e) {
        console.log(`  ⚠️ 关闭失败: ${e}`);
      }

      execSync('sleep 0.5');
      const currentWindows = getQianniuWindowNames();
      const stillHas = currentWindows.some(w => w.includes('询问'));
      if (!stillHas) {
        console.log(`\n✅ 尝试 ${attempt} 次后成功关闭询问窗口！`);
        return true;
      }

      console.log(`  ⚠️ 窗口仍在，剩余 ${MAX_TRIES - attempt} 次尝试`);
    }

    console.log('\n═══════════════════════════════════════');
    console.log('🔴  自动关闭失败！请手动关闭询问窗口');
    console.log('   关闭后按 Enter 继续...');
    console.log('═══════════════════════════════════════');

    try {
      execSync('afplay /System/Library/Sounds/Basso.aiff', { timeout: 2000 });
      execSync('afplay /System/Library/Sounds/Basso.aiff', { timeout: 2000 });
    } catch {}

    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>(resolve => rl.question('', () => { rl.close(); resolve(); }));

    const windowsAfter = getQianniuWindowNames();
    if (!windowsAfter.some(w => w.includes('询问'))) {
      console.log('✅ 询问窗口已手动关闭');
      return true;
    }
  }

  console.log('🔍 策略1: 尝试按键关闭弹窗...');
  closePopupByKey();

  execSync('sleep 0.5');
  const windowsAfterKey = getQianniuWindowNames();
  const stillHasPopup = windowsAfterKey.some(w => popupKeywords.some(kw => w.includes(kw)));
  if (!stillHasPopup) {
    console.log('✅ 按键关闭成功');
    return true;
  }
  console.log('⚠️ 按键关闭无效，弹窗仍在');

  console.log('🔍 策略2: 尝试点击关闭按钮...');
  if (closePopupByClick()) {
    console.log('✅ 点击关闭按钮成功');
    return true;
  }

  const allWindows = getQianniuWindowNames();
  console.log(`📋 当前窗口列表: ${allWindows.length} 个`);

  const matchedWindows = allWindows.filter(w => popupKeywords.some(kw => w.includes(kw)));
  if (matchedWindows.length === 0) {
    return false;
  }

  console.log(`🔍 检测到 ${matchedWindows.length} 个弹窗`);
  const closedCount = closeWindowsContainingKeywords(popupKeywords);
  if (closedCount > 0) {
    console.log(`✅ 共关闭 ${closedCount} 个弹窗`);
    execSync('sleep 0.3');
    return true;
  }

  return false;
}

export function getChatWindowPosition(): Rect | null {
  try {
    const windows = getAllQianniuWindows();
    const chatWindow = resolveWindow('单聊', windows) || resolveWindow('接待中心', windows);
    if (!chatWindow) return null;

    const { x, y, w, h } = chatWindow;
    return {
      x: x + 20,
      y: y + 60,
      w: w - 40,
      h: h - 150,
    };
  } catch (e) {
    console.log('⚠️ 获取窗口位置失败:', e);
    return null;
  }
}

export function loadRecordedPoint(pointName: string): Point | null {
  const recordingsPath = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/recordings.json';
  if (!fs.existsSync(recordingsPath)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(recordingsPath, 'utf8'));
    const point = data.points?.find((p: any) => p.name === pointName);
    if (!point) return null;

    const pointType = point.type || 'ratio';

    if (pointType === 'fixed' || ('fixedX' in point && 'fixedY' in point)) {
      return { x: point.fixedX as number, y: point.fixedY as number };
    }

    if (pointType === 'ratio' || point.ratioX !== undefined || point.ratioY !== undefined) {
      if (!point.windowName) {
        console.log(`⚠️ 录制点 "${pointName}" 缺少 windowName`);
        return null;
      }

      const windows = getAllQianniuWindows();
      const targetWindow = resolveWindow(point.windowName, windows, pointName);
      if (!targetWindow) {
        console.log(` [${new Date().toLocaleString()}]  ⚠️找不到窗口: ${point.windowName}`);
        if (windows.length > 0) {
          console.log(`  当前窗口: ${windows.map(w => w.name).join(' | ')}`);
        }
        appendAuditLog('recorded-point-miss', {
          pointName,
          pointType,
          expectedWindow: point.windowName,
          currentWindows: windows.map(w => w.name),
        }, 'warn');
        return null;
      }

      const { x: wx, y: wy, w: ww, h: wh } = targetWindow;
      const resolvedPoint = {
        x: Math.round(wx + (point.ratioX || 0) * ww),
        y: Math.round(wy + (point.ratioY || 0) * wh),
      };
      appendAuditLog('recorded-point-resolve', {
        pointName,
        pointType,
        expectedWindow: point.windowName,
        matchedWindow: targetWindow.name,
        windowRect: { x: wx, y: wy, w: ww, h: wh },
        resolvedPoint,
      });
      return resolvedPoint;
    }

    if (pointType === 'offset') {
      if (!point.windowName || point.offsetX === undefined || point.offsetY === undefined) {
        console.log(`⚠️ 录制点 "${pointName}" 缺少 windowName 或 offsetX/offsetY`);
        return null;
      }

      const windows = getAllQianniuWindows();
      const targetWindow = resolveWindow(point.windowName, windows, pointName);
      if (!targetWindow) {
        console.log(`⚠️ [${new Date().toLocaleString()}] 找不到窗口: ${point.windowName}`);
        if (windows.length > 0) {
          console.log(`  当前窗口: ${windows.map(w => w.name).join(' | ')}`);
        }
        appendAuditLog('recorded-point-miss', {
          pointName,
          pointType,
          expectedWindow: point.windowName,
          currentWindows: windows.map(w => w.name),
        }, 'warn');
        return null;
      }

      const resolvedPoint = {
        x: targetWindow.x + point.offsetX,
        y: targetWindow.y + point.offsetY,
      };
      appendAuditLog('recorded-point-resolve', {
        pointName,
        pointType,
        expectedWindow: point.windowName,
        matchedWindow: targetWindow.name,
        windowRect: { x: targetWindow.x, y: targetWindow.y, w: targetWindow.w, h: targetWindow.h },
        resolvedPoint,
      });
      return resolvedPoint;
    }

    console.log(`⚠️ 录制点 "${pointName}" 类型未知: ${pointType}`);
    return null;
  } catch (e) {
    console.error('加载记录点失败:', e);
    return null;
  }
}

export function loadCalibrateConfig(): Rect | null {
  const configPath = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/calibrate.json';
  try {
    if (!fs.existsSync(configPath)) return null;

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.x !== undefined && config.y !== undefined) {
      return {
        x: config.x,
        y: config.y,
        w: config.w || 500,
        h: config.h || 300,
      };
    }

    if (config.offsetX === undefined || config.offsetY === undefined) {
      return null;
    }

    const getCurrentWindowPos = (): Rect | null => {
      try {
        const window = resolveWindow('接待中心', getAllQianniuWindows()) || getAllQianniuWindows()[0];
        if (!window) return null;
        return { x: window.x, y: window.y, w: window.w, h: window.h };
      } catch {
        return null;
      }
    };

    const winPos = getCurrentWindowPos();
    if (!winPos) return null;

    return {
      x: winPos.x + config.offsetX,
      y: winPos.y + config.offsetY,
      w: config.chatW || 500,
      h: config.chatH || 300,
    };
  } catch {
    return null;
  }
}

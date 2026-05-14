import { execSync } from 'child_process';
import * as fs from 'fs';
import { Point, Rect } from '../types';

export const ALIWORKBENCH = 'Aliworkbench';
export const RECEPTION: Rect = { x: 27, y: 38, w: 1310, h: 800 };

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
  execSync('sleep 0.5');
}

export function getQianniuWindowNames(): string[] {
  try {
    const script = `
      tell application "System Events"
        tell process "Aliworkbench"
          set winNames to ""
          repeat with i from 1 to count of windows
            try
              set wName to name of window i
              set winNames to winNames & wName & "|||"
            end try
          end repeat
          return winNames
        end tell
      end tell
    `;
    const result = runScript(script).trim();
    if (!result) return [];
    return result.split('|||').filter(Boolean);
  } catch {
    return [];
  }
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
  const script = `
    tell application "System Events"
      tell process "Aliworkbench"
        set chatWindow to missing value
        try
          set allWindows to every window
          repeat with w in allWindows
            set winName to name of w
            if winName contains "单聊" then
              set chatWindow to w
              exit repeat
            end if
          end repeat
        end try

        if chatWindow is missing value then
          return "NOT_FOUND"
        end if

        set winPos to position of chatWindow
        set winSize to size of chatWindow
        return (item 1 of winPos) & "," & (item 2 of winPos) & "," & (item 1 of winSize) & "," & (item 2 of winSize)
      end tell
    end tell
  `;

  try {
    const result = runScript(script).trim();
    if (result === 'NOT_FOUND') return null;

    const [x, y, w, h] = result.split(',').map(Number);
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

      const windowScript = `
        tell application "System Events"
          tell process "${ALIWORKBENCH}"
            set out to ""
            repeat with i from 1 to count of windows
              set wName to name of window i
              set p to position of window i
              set s to size of window i
              set out to out & wName & "|" & (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s) & ";"
            end repeat
            return out
          end tell
        end tell
      `;

      const result = runScript(windowScript);
      if (!result) return null;

      const windows = result.split(';').filter(Boolean).map(seg => {
        const [name, coords] = seg.split('|');
        const parts = coords.split(',').map((s: string) => parseInt(s.trim(), 10));
        return { name: name || '', x: parts[0] || 0, y: parts[1] || 0, w: parts[2] || 0, h: parts[3] || 0 };
      });

      const targetWindow = windows.find(w => w.name === point.windowName);
      if (!targetWindow) {
        console.log(` [${new Date().toLocaleString()}]  ⚠️找不到窗口: ${point.windowName}`);
        return null;
      }

      const { x: wx, y: wy, w: ww, h: wh } = targetWindow;
      return {
        x: Math.round(wx + (point.ratioX || 0) * ww),
        y: Math.round(wy + (point.ratioY || 0) * wh),
      };
    }

    if (pointType === 'offset') {
      if (!point.windowName || point.offsetX === undefined || point.offsetY === undefined) {
        console.log(`⚠️ 录制点 "${pointName}" 缺少 windowName 或 offsetX/offsetY`);
        return null;
      }

      const windowScript = `
        tell application "System Events"
          tell process "${ALIWORKBENCH}"
            try
              tell window "${point.windowName}"
                set p to position
                return (item 1 of p) & "," & (item 2 of p)
              end tell
            on error
              return "NOT_FOUND"
            end try
          end tell
        end tell
      `;

      const result = runScript(windowScript);
      if (result === 'NOT_FOUND' || !result) {
        console.log(`⚠️ [${new Date().toLocaleString()}] 找不到窗口: ${point.windowName}`);
        return null;
      }

      const [wx, wy] = result.split(',').map(Number);
      return {
        x: wx + point.offsetX,
        y: wy + point.offsetY,
      };
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
        const posScript = `tell application "System Events" to tell process "Aliworkbench" to get position of window 1`;
        const sizeScript = `tell application "System Events" to tell process "Aliworkbench" to get size of window 1`;

        const posResult = execSync(`osascript -e '${posScript}'`, { encoding: 'utf8' }).trim();
        const sizeResult = execSync(`osascript -e '${sizeScript}'`, { encoding: 'utf8' }).trim();

        const [x, y] = posResult.split(',').map((s: string) => parseInt(s.trim(), 10));
        const [w, h] = sizeResult.split(',').map((s: string) => parseInt(s.trim(), 10));

        if (isNaN(x) || isNaN(y)) return null;
        return { x, y, w, h };
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

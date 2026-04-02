/**
 * AppleScript 封装
 * 通过 osascript 调用系统 AppleScript，实现窗口操作、点击、输入等
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);
const TMP_SCRIPT = '/tmp/qianniu-automation-script.scpt';

/**
 * 执行 AppleScript 脚本（写文件方式，避免多行转义问题）
 */
export function runScriptSync(script: string): string {
  try {
    // 写脚本到临时文件
    fs.writeFileSync(TMP_SCRIPT, script, 'utf8');
    return execSync(`osascript ${TMP_SCRIPT}`, { timeout: 30000, encoding: 'utf8' }).trim();
  } catch (e: any) {
    const stderr = e.stderr || '';
    if (stderr) {
      throw new Error(`AppleScript 执行失败: ${stderr.trim().split('\n').slice(-1)[0]}`);
    }
    throw new Error(`AppleScript 执行失败: ${e.message}`);
  }
}

/**
 * 异步执行 AppleScript 脚本
 */
export async function runScript(script: string): Promise<string> {
  try {
    fs.writeFileSync(TMP_SCRIPT, script, 'utf8');
    const { stdout } = await execAsync(`osascript ${TMP_SCRIPT}`, { timeout: 30000 });
    return stdout.trim();
  } catch (e: any) {
    throw new Error(`AppleScript 执行失败: ${e.message}`);
  }
}

/**
 * 激活指定应用到前台
 */
export function activateApp(bundleId: string): void {
  const script = `tell application "${bundleId}" to activate`;
  runScriptSync(script);
}

/**
 * 获取窗口信息
 */
export function getWindowInfo(windowName: string): {
  position: { x: number; y: number };
  size: { width: number; height: number };
} {
  const result = runScriptSync(`
    tell application "System Events"
      tell process "Aliworkbench"
        tell window "${windowName}"
          set pos to position
          set sz to size
          return (item 1 of pos as string) & "," & (item 2 of pos as string) & "|" & (item 1 of sz as string) & "," & (item 2 of sz as string)
        end tell
      end tell
    end tell
  `);

  const [pos, size] = result.split('|');
  const [x, y] = pos.split(',').map(Number);
  const [w, h] = size.split(',').map(Number);

  return { position: { x, y }, size: { width: w, height: h } };
}

/**
 * 获取进程的所有窗口信息
 */
export function getAllWindows(processName: string): Array<{
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}> {
  const result = runScriptSync(`
    tell application "System Events"
      tell process "${processName}"
        set winInfo to ""
        set winCount to count of windows
        repeat with i from 1 to winCount
          try
            set wName to name of window i
            set pos to position of window i
            set sz to size of window i
            set winInfo to winInfo & wName & "|" & (item 1 of pos) & "," & (item 2 of pos) & "," & (item 1 of sz) & "," & (item 2 of sz) & ";"
          end try
        end repeat
        return winInfo
      end tell
    end tell
  `);

  if (!result) return [];

  return result.split(';').filter(Boolean).map(segment => {
    const [name, coords] = segment.split('|');
    const [x, y, w, h] = coords.split(',').map(Number);
    return {
      name: name || '(无标题)',
      position: { x, y },
      size: { width: w, height: h }
    };
  });
}

/**
 * 获取窗口内的所有 UI 元素（树结构）
 */
export function getWindowElements(windowName: string, maxDepth = 3): string {
  const script = `
    tell application "System Events"
      tell process "Aliworkbench"
        try
          set elemList to {}
          set winRef to window "${windowName}"
          
          -- 递归获取元素信息
          on getElemInfo(elem, indent)
            set info to ""
            try
              set elemRole to role of elem as string
              set elemName to name of elem as string
              set elemValue to value of elem as string
              set elemDesc to description of elem as string
              
              if elemRole is not "" then
                set info to info & indent & "[" & elemRole & "] " & elemName
                if elemValue is not "" and elemValue is not missing value then
                  set info to info & " = " & elemValue
                end if
                if elemDesc is not "" and elemDesc is not missing value then
                  set info to info & " (" & elemDesc & ")"
                end if
                set info to info & "\\n"
              end if
              
              -- 获取子元素
              try
                set childCount to count of UI elements of elem
                repeat with j from 1 to min(childCount, 5)
                  set childElem to UI element j of elem
                  set info to info & getElemInfo(childElem, indent & "  ")
                end repeat
              end try
            end try
            return info
          end getElemInfo
          
          return getElemInfo(winRef, "")
        on error errMsg
          return "Error: " & errMsg
        end try
      end tell
    end tell
  `;

  return runScriptSync(script);
}

/**
 * 点击指定坐标（屏幕坐标）
 */
export function clickAt(screenX: number, screenY: number): void {
  runScriptSync(`
    tell application "System Events"
      click at {${screenX}, ${screenY}}
    end tell
  `);
}

/**
 * 双击指定坐标
 */
export function doubleClickAt(screenX: number, screenY: number): void {
  runScriptSync(`
    tell application "System Events"
      double click at {${screenX}, ${screenY}}
    end tell
  `);
}

/**
 * 获取元素的屏幕坐标
 */
export function getElementPosition(elementPath: string): { x: number; y: number } | null {
  try {
    const result = runScriptSync(`
      tell application "System Events"
        tell process "Aliworkbench"
          try
            set elemPos to position of ${elementPath}
            return (item 1 of elemPos as string) & "," & (item 2 of elemPos as string)
          on error
            return "NOT_FOUND"
          end try
        end tell
      end tell
    `);

    if (result === 'NOT_FOUND') return null;

    const [x, y] = result.split(',').map(Number);
    return { x, y };
  } catch {
    return null;
  }
}

/**
 * 模拟按键
 */
export function pressKey(key: string, modifiers: string[] = []): void {
  const modStr = modifiers.length > 0 ? modifiers.join(', ') : '';
  const script = modStr
    ? `key code {${modStr}, ${key}}`
    : `key code ${key}`;

  runScriptSync(`
    tell application "System Events"
      tell process "Aliworkbench"
        keystroke ${key} ${modStr ? `using {${modStr}}` : ''}
      end tell
    end tell
  `);
}

/**
 * 获取聊天消息区域的文字
 */
export function getChatMessages(): string {
  const script = `
    tell application "System Events"
      tell process "Aliworkbench"
        try
          set msgTexts to {}
          tell window 1
            set msgTexts to value of every static text of splitter group 1
          end tell
          return msgTexts as string
        on error errMsg
          return "Error: " & errMsg
        end try
      end tell
    end tell
  `;

  return runScriptSync(script);
}

/**
 * 发送文本到当前焦点输入框
 */
export function typeText(text: string): void {
  runScriptSync(`
    tell application "System Events"
      tell process "Aliworkbench"
        set the clipboard to "${text.replace(/"/g, '\\"')}"
        keystroke "v" using command down
      end tell
    end tell
  `);
}

/**
 * 按 Enter 发送
 */
export function pressEnter(): void {
  runScriptSync(`
    tell application "System Events"
      tell process "Aliworkbench"
        keystroke return
      end tell
    end tell
  `);
}

/**
 * 关闭包含指定文字的窗口
 * @param text 要查找的窗口标题文字
 * @param processName 进程名，默认为 "Aliworkbench"（千牛）
 * @returns 是否成功关闭
 */
export function closeWindowContainingText(text: string, processName = 'Aliworkbench'): boolean {
  try {
    const script = `
      tell application "System Events"
        tell process "${processName}"
          set winList to windows
          repeat with win in winList
            try
              set winName to name of win
              if winName contains "${text}" then
                close win
                return "CLOSED"
              end if
            end try
          end repeat
          return "NOT_FOUND"
        end tell
      end tell
    `;

    const result = runScriptSync(script);
    return result.trim() === 'CLOSED';
  } catch (e) {
    console.error(`关闭窗口失败: ${e}`);
    return false;
  }
}

/**
 * 关闭当前活动窗口 (Cmd+W)
 * @param processName 进程名，默认为 "Aliworkbench"
 */
export function closeActiveWindow(processName = 'Aliworkbench'): void {
  runScriptSync(`
    tell application "System Events"
      tell process "${processName}"
        keystroke "w" using command down
      end tell
    end tell
  `);
}

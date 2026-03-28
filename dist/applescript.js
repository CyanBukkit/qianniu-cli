"use strict";
/**
 * AppleScript 封装
 * 通过 osascript 调用系统 AppleScript，实现窗口操作、点击、输入等
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runScriptSync = runScriptSync;
exports.runScript = runScript;
exports.activateApp = activateApp;
exports.getWindowInfo = getWindowInfo;
exports.getAllWindows = getAllWindows;
exports.getWindowElements = getWindowElements;
exports.clickAt = clickAt;
exports.doubleClickAt = doubleClickAt;
exports.getElementPosition = getElementPosition;
exports.pressKey = pressKey;
exports.getChatMessages = getChatMessages;
exports.typeText = typeText;
exports.pressEnter = pressEnter;
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const TMP_SCRIPT = '/tmp/qianniu-automation-script.scpt';
/**
 * 执行 AppleScript 脚本（写文件方式，避免多行转义问题）
 */
function runScriptSync(script) {
    try {
        // 写脚本到临时文件
        fs.writeFileSync(TMP_SCRIPT, script, 'utf8');
        return (0, child_process_1.execSync)(`osascript ${TMP_SCRIPT}`, { timeout: 30000, encoding: 'utf8' }).trim();
    }
    catch (e) {
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
async function runScript(script) {
    try {
        fs.writeFileSync(TMP_SCRIPT, script, 'utf8');
        const { stdout } = await execAsync(`osascript ${TMP_SCRIPT}`, { timeout: 30000 });
        return stdout.trim();
    }
    catch (e) {
        throw new Error(`AppleScript 执行失败: ${e.message}`);
    }
}
/**
 * 激活指定应用到前台
 */
function activateApp(bundleId) {
    const script = `tell application "${bundleId}" to activate`;
    runScriptSync(script);
}
/**
 * 获取窗口信息
 */
function getWindowInfo(windowName) {
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
function getAllWindows(processName) {
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
    if (!result)
        return [];
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
function getWindowElements(windowName, maxDepth = 3) {
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
function clickAt(screenX, screenY) {
    runScriptSync(`
    tell application "System Events"
      click at {${screenX}, ${screenY}}
    end tell
  `);
}
/**
 * 双击指定坐标
 */
function doubleClickAt(screenX, screenY) {
    runScriptSync(`
    tell application "System Events"
      double click at {${screenX}, ${screenY}}
    end tell
  `);
}
/**
 * 获取元素的屏幕坐标
 */
function getElementPosition(elementPath) {
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
        if (result === 'NOT_FOUND')
            return null;
        const [x, y] = result.split(',').map(Number);
        return { x, y };
    }
    catch {
        return null;
    }
}
/**
 * 模拟按键
 */
function pressKey(key, modifiers = []) {
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
function getChatMessages() {
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
function typeText(text) {
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
function pressEnter() {
    runScriptSync(`
    tell application "System Events"
      tell process "Aliworkbench"
        keystroke return
      end tell
    end tell
  `);
}

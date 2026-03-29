/**
 * 剪贴板读取模块 - 替代 OCR
 * 通过全选复制获取聊天内容
 */

import { execSync } from 'child_process';

// ============ 读取聊天内容 =================

/**
 * 读取聊天区域内容
 * 流程：点击 → 全选 → 复制 → 读取剪贴板 → 再点击结束选中
 * @returns 聊天内容（后500字）
 */
export function readChatContent(): string {
  try {
    // 点击聊天记录区域（ratio模式）
    const chatAreaPoint = loadRecordedPoint('聊天记录');
    if (!chatAreaPoint) {
      console.log('⚠️ 未找到"聊天记录"坐标');
      return '';
    }
    
    console.log(`  📍 聊天记录: (${chatAreaPoint.x}, ${chatAreaPoint.y})`);
    console.log(`  📋 读取聊天内容...`);
    execSync(`cliclick c:${chatAreaPoint.x},${chatAreaPoint.y}`, { timeout: 5000 });
    execSync('sleep 0.3');
    
    // 全选 Command+A
    runScript(`tell application "System Events" to keystroke "a" using command down`);
    execSync('sleep 0.2');
    
    // 复制 Command+C
    runScript(`tell application "System Events" to keystroke "c" using command down`);
    execSync('sleep 0.3');
    
    // 读取剪贴板
    const clipboard = execSync('pbpaste', { encoding: 'utf8' }).trim();
    
    // 再点击一下结束选中状态
    execSync(`cliclick c:${chatAreaPoint.x},${chatAreaPoint.y}`, { timeout: 5000 });
    
    // 只返回后500字
    const content = clipboard.length > 500 ? clipboard.slice(-500) : clipboard;
    console.log(`  📋 内容 (${clipboard.length}字)`);
    
    return content;
  } catch (e) {
    console.error('读取聊天内容失败:', e);
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

// ============ 辅助函数 =================

function runScript(script: string): string {
  const tmpFile = `/tmp/qianniu-script-${Date.now()}.scpt`;
  const fs = require('fs');
  fs.writeFileSync(tmpFile, script);
  try {
    return execSync(`osascript ${tmpFile}`, { timeout: 5000, encoding: 'utf8' }).trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

/**
 * 加载录制点（从 recordings.json）
 * 支持 fixed 和 ratio 模式
 * 使用窗口索引方式避免中文转义问题
 */
function loadRecordedPoint(pointName: string): { x: number; y: number } | null {
  const fs = require('fs');
  const recordingsPath = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/recordings.json';
  if (!fs.existsSync(recordingsPath)) return null;
  
  try {
    const data = JSON.parse(fs.readFileSync(recordingsPath, 'utf8'));
    const point = data.points?.find((p: any) => p.name === pointName);
    if (!point) return null;
    
    // fixed 模式
    if (point.type === 'fixed' || (point.fixedX !== undefined && point.fixedY !== undefined)) {
      return { x: point.fixedX, y: point.fixedY };
    }
    
    // ratio 模式 - 遍历所有窗口精确匹配
    if (point.type === 'ratio' || point.ratioX !== undefined) {
      const windowScript = `
        tell application "System Events"
          tell process "Aliworkbench"
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
        const parts = coords.split(',').map(s => parseInt(s.trim(), 10));
        return { name: name || '', x: parts[0] || 0, y: parts[1] || 0, w: parts[2] || 0, h: parts[3] || 0 };
      });
      
      // 使用录制时的 windowName 精确匹配
      const targetWindow = windows.find(w => w.name === point.windowName);
      if (!targetWindow) return null;
      
      const { x: wx, y: wy, w: ww, h: wh } = targetWindow;
      const x = Math.round(wx + (point.ratioX || 0) * ww);
      const y = Math.round(wy + (point.ratioY || 0) * wh);
      
      return { x, y };
    }
    
    return null;
  } catch {
    return null;
  }
}

// ============ 兼容旧 OCR 接口 =================

/**
 * 兼容旧接口 - 旧代码调用这个
 * 现在直接读取剪贴板内容
 */
export async function recognizeText(imagePath: string): Promise<string> {
  return readChatContent();
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
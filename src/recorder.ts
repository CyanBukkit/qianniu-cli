/**
 * 坐标录制与回放模块
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as readline from 'readline';

const RECORDINGS_FILE = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/recordings.json';

// ============ 类型 ============

interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 坐标点类型：ratio(比例) | fixed(固定坐标) | offset(窗口偏移)
type PointType = 'ratio' | 'fixed' | 'offset';

interface RecordedPoint {
  name: string;
  type?: PointType;           // 模式类型
  windowName?: string;        // 窗口名称 (ratio/offset模式需要)
  ratioX?: number;            // 比例坐标 (ratio模式)
  ratioY?: number;            // 比例坐标 (ratio模式)
  fixedX?: number;            // 固定坐标 (fixed模式)
  fixedY?: number;            // 固定坐标 (fixed模式)
  offsetX?: number;           // 窗口偏移 (offset模式)
  offsetY?: number;           // 窗口偏移 (offset模式)
  recordedAt: string;
}

interface RecordingData {
  version: number;
  windowName: string;
  windowRect: WindowRect;
  points: RecordedPoint[];
}

// ============ 工具函数 ============

function runScript(script: string): string {
  const tmpFile = `/tmp/qianniu-rec-${Date.now()}.scpt`;
  fs.writeFileSync(tmpFile, script);
  try {
    return execSync(`osascript ${tmpFile}`, { timeout: 20000, encoding: 'utf8' }).trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function clickAt(x: number, y: number): void {
  execSync(`cliclick c:${x},${y}`, { timeout: 5000 });
}

function getWindowRect(windowName: string, processName = 'Aliworkbench'): WindowRect | null {
  const script = `
    tell application "System Events"
      tell process "${processName}"
        try
          tell window "${windowName}"
            set p to position
            set s to size
            return (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s)
          end tell
        on error
          return "NOT_FOUND"
        end try
      end tell
    end tell
  `;
  const result = runScript(script);
  if (result === 'NOT_FOUND') return null;
  // 先按逗号分割，过滤空字符串，再解析数字
  const parts = result.split(',').filter(s => s.trim()).map(s => parseInt(s.trim(), 10));
  const [x, y, w, h] = parts;
  if (isNaN(x) || isNaN(y) || isNaN(w) || isNaN(h)) {
    console.error('解析窗口失败:', result);
    return null;
  }
  return { x, y, w, h };
}

function listWindows(processName = 'Aliworkbench'): Array<{ name: string; rect: WindowRect }> {
  const script = `
    tell application "System Events"
      tell process "${processName}"
        set out to ""
        repeat with i from 1 to count of windows
          try
            set w to window i
            set n to name of w
            set p to position of w
            set s to size of w
            set out to out & n & "|" & (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s) & ";"
          end try
        end repeat
        return out
      end tell
    end tell
  `;
  const result = runScript(script);
  return result.split(';').filter(Boolean).map(seg => {
    const [n, coords] = seg.split('|');
    const parts = coords.split(',').filter(s => s.trim()).map(s => parseInt(s.trim(), 10));
    const [x, y, w, h] = parts;
    return { name: n || '(无标题)', rect: { x: x || 0, y: y || 0, w: w || 0, h: h || 0 } };
  });
}

function calculateRatio(screenX: number, screenY: number, windowRect: WindowRect): { ratioX: number; ratioY: number } {
  return {
    ratioX: (screenX - windowRect.x) / windowRect.w,
    ratioY: (screenY - windowRect.y) / windowRect.h
  };
}

function calculateScreenPos(ratioX: number, ratioY: number, windowRect: WindowRect): { x: number; y: number } {
  return {
    x: Math.round(windowRect.x + ratioX * windowRect.w),
    y: Math.round(windowRect.y + ratioY * windowRect.h)
  };
}

// ============ 录制相关 ============

function loadRecordings(): RecordingData {
  if (!fs.existsSync(RECORDINGS_FILE)) {
    return {
      version: 1,
      windowName: 't_1487330154436_074-接待中心',
      windowRect: { x: 0, y: 0, w: 1310, h: 800 },
      points: []
    };
  }
  return JSON.parse(fs.readFileSync(RECORDINGS_FILE, 'utf8'));
}

function saveRecordings(data: RecordingData): void {
  fs.writeFileSync(RECORDINGS_FILE, JSON.stringify(data, null, 2));
}

/**
 * 录制坐标点
 * @param name 点名称
 * @param type 模式: 'ratio'(默认比例) | 'fixed'(固定坐标) | 'offset'(窗口偏移)
 */
function recordPoint(name: string, type: string = 'ratio'): void {
  console.log(`\n📌 录制点: ${name} [${type}]`);
  
  // 固定坐标模式：直接获取鼠标位置，不需要窗口
  if (type === 'fixed') {
    console.log(`⏳ 10 秒内点击目标位置...`);
    
    const script = `
from pynput import mouse
import time

result = ["TIMEOUT"]
start = time.time()

def on_click(x, y, button, pressed):
    if pressed:
        result[0] = f"{x},{y}"
        return False

with mouse.Listener(on_click=on_click) as listener:
    while listener.running and time.time() - start < 10:
        time.sleep(0.1)

print(result[0])
`;
    try {
      const posResult = execSync(`python3 -c '${script.replace(/'/g, "'\\''")}'`, { timeout: 15000, encoding: 'utf8' }).trim();
      const [fixedX, fixedY] = posResult.split(',').map(Number);
      console.log(`🖱️  固定坐标: (${fixedX}, ${fixedY})`);
      
      const data = loadRecordings();
      const existing = data.points.find(p => p.name === name);
      if (existing) {
        existing.type = 'fixed';
        existing.fixedX = fixedX;
        existing.fixedY = fixedY;
        existing.recordedAt = new Date().toISOString();
        console.log(`✅ 已更新: ${name}`);
      } else {
        data.points.push({ name, type: 'fixed', fixedX, fixedY, recordedAt: new Date().toISOString() });
        console.log(`✅ 已保存: ${name}`);
      }
      saveRecordings(data);
    } catch (e: any) {
      console.error('❌ 录制失败:', e.message);
    }
    return;
  }
  
  // 比例模式或偏移模式：需要窗口
  console.log(`⏳ 10 秒内切换到千牛窗口，点击目标位置...`);

  const script = `
from pynput import mouse
import time

result = ["TIMEOUT"]
start = time.time()

def on_click(x, y, button, pressed):
    if pressed:
        result[0] = f"{x},{y}"
        return False

with mouse.Listener(on_click=on_click) as listener:
    while listener.running and time.time() - start < 10:
        time.sleep(0.1)

print(result[0])
`;

  try {
    const result = execSync(`python3 -c '${script.replace(/'/g, "'\\''")}'`, { timeout: 15000, encoding: 'utf8' }).trim();
    
    const [screenX, screenY] = result.split(',').map(Number);
    console.log(`🖱️  点击位置: (${screenX}, ${screenY})`);

    // 自动检测点击位置属于哪个窗口
    const windows = listWindows();
    let targetWindow: { name: string; rect: WindowRect } | null = null;
    
    for (const win of windows) {
      const { x, y, w, h } = win.rect;
      if (screenX >= x && screenX <= x + w && screenY >= y && screenY <= y + h) {
        targetWindow = win;
        break;
      }
    }

    if (!targetWindow) {
      // 如果没找到匹配，使用接待中心作为默认
      targetWindow = windows.find(w => w.name.includes('接待中心')) || windows[0] || null;
      if (targetWindow) {
        console.log(`⚠️ 未找到匹配窗口，使用: ${targetWindow.name}`);
      } else {
        console.error('❌ 找不到任何窗口');
        return;
      }
    }

    const windowRect = targetWindow.rect;
    const windowName = targetWindow.name;
    console.log(`📐 窗口: ${windowName} (${windowRect.x}, ${windowRect.y}) ${windowRect.w}x${windowRect.h}`);

    const data = loadRecordings();
    const existing = data.points.find(p => p.name === name);
    
    if (type === 'ratio') {
      const { ratioX, ratioY } = calculateRatio(screenX, screenY, windowRect);
      console.log(`📊 比例: (${ratioX.toFixed(4)}, ${ratioY.toFixed(4)})`);
      
      if (existing) {
        existing.type = 'ratio';
        existing.ratioX = ratioX;
        existing.ratioY = ratioY;
        existing.windowName = windowName;
        existing.recordedAt = new Date().toISOString();
        console.log(`✅ 已更新: ${name}`);
      } else {
        data.points.push({ name, type: 'ratio', windowName, ratioX, ratioY, recordedAt: new Date().toISOString() });
        console.log(`✅ 已保存: ${name}`);
      }
    } else if (type === 'offset') {
      const offsetX = screenX - windowRect.x;
      const offsetY = screenY - windowRect.y;
      console.log(`📊 偏移: (${offsetX}, ${offsetY})`);
      
      if (existing) {
        existing.type = 'offset';
        existing.offsetX = offsetX;
        existing.offsetY = offsetY;
        existing.windowName = windowName;
        existing.recordedAt = new Date().toISOString();
        console.log(`✅ 已更新: ${name}`);
      } else {
        data.points.push({ name, type: 'offset', windowName, offsetX, offsetY, recordedAt: new Date().toISOString() });
        console.log(`✅ 已保存: ${name}`);
      }
    }

    data.windowName = windowName;
    data.windowRect = windowRect;
    saveRecordings(data);
  } catch (e: any) {
    if (e.message.includes('pynput')) {
      console.log('⚠️  需要安装: pip3 install pynput');
    } else {
      console.error('❌ 录制失败:', e.message);
    }
  }
}

function interactiveRecord(): void {
  console.log('\n=== 录制模式 ===');
  console.log('输入点名称（可带模式后缀），切换到千牛窗口点击，输入 q 退出\n');
  console.log('模式说明:');
  console.log('  直接输入名称     - 比例模式 (ratio)');
  console.log('  名称@fixed      - 固定坐标模式');
  console.log('  名称@offset     - 窗口偏移量模式\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question('点名称 (名称@模式 或 q): ', (input) => {
      if (input.toLowerCase() === 'q') {
        console.log('\n✅ 录制结束');
        listPoints();
        rl.close();
        return;
      }
      if (!input.trim()) { ask(); return; }
      
      // 解析名称和模式
      let name = input.trim();
      let type = 'ratio';
      if (name.includes('@')) {
        const parts = name.split('@');
        name = parts[0].trim();
        type = parts[1].trim().toLowerCase();
        if (!['ratio', 'fixed', 'offset'].includes(type)) {
          console.log(`⚠️ 未知模式: ${type}，使用默认 ratio`);
          type = 'ratio';
        }
      }
      
      if (!name) { ask(); return; }
      recordPoint(name, type);
      ask();
    });
  };
  ask();
}

function replayPoint(name: string): boolean {
  const data = loadRecordings();
  const point = data.points.find(p => p.name === name);

  if (!point) {
    console.error(`❌ 找不到: ${name}`);
    console.log(`已录制: ${data.points.map(p => p.name).join(', ') || '无'}`);
    return false;
  }

  const pointType = point.type || 'ratio';
  let x: number, y: number;

  // ========== 模式1: 固定坐标 (fixed) ==========
  if (pointType === 'fixed' || ('fixedX' in point && 'fixedY' in point)) {
    x = point.fixedX as number;
    y = point.fixedY as number;
    console.log(`📍 ${name} [fixed]: 点击固定坐标 (${x}, ${y})`);
  }
  // ========== 模式2: 比例坐标 (ratio) ==========
  else if (pointType === 'ratio' || point.ratioX !== undefined) {
    const windowRect = getWindowRect(point.windowName);
    if (!windowRect) {
      console.error(`❌ 找不到窗口: ${point.windowName}`);
      return false;
    }
    const pos = calculateScreenPos(point.ratioX, point.ratioY, windowRect);
    x = pos.x;
    y = pos.y;
    console.log(`📍 ${name} [ratio]: 点击 (${x}, ${y})`);
  }
  // ========== 模式3: 窗口偏移量 (offset) ==========
  else if (pointType === 'offset') {
    const windowRect = getWindowRect(point.windowName);
    if (!windowRect) {
      console.error(`❌ 找不到窗口: ${point.windowName}`);
      return false;
    }
    x = windowRect.x + point.offsetX;
    y = windowRect.y + point.offsetY;
    console.log(`📍 ${name} [offset]: 点击 (${x}, ${y})`);
  }
  else {
    console.error(`❌ 未知模式: ${pointType}`);
    return false;
  }

  clickAt(x, y);
  return true;
}

function listPoints(): void {
  const data = loadRecordings();
  console.log(`\n窗口: ${data.windowName}`);
  console.log(`尺寸: ${data.windowRect.w}x${data.windowRect.h}`);
  console.log(`\n已录制 (${data.points.length} 个):`);
  console.log('模式说明: ratio=比例坐标 | fixed=固定坐标 | offset=窗口偏移\n');
  data.points.forEach((p, i) => {
    const type = p.type || 'ratio';
    if (type === 'fixed') {
      console.log(`  ${i + 1}. ${p.name} [fixed] → 坐标 (${p.fixedX}, ${p.fixedY})`);
    } else if (type === 'offset') {
      console.log(`  ${i + 1}. ${p.name} [offset] → 偏移 ${p.windowName} (${p.offsetX}, ${p.offsetY})`);
    } else if (type === 'ratio') {
      console.log(`  ${i + 1}. ${p.name} [ratio] → ${p.windowName} (${p.ratioX?.toFixed(4)}, ${p.ratioY?.toFixed(4)})`);
    } else {
      console.log(`  ${i + 1}. ${p.name} → (类型未知: ${type})`);
    }
  });
}

function deletePoint(name: string): void {
  const data = loadRecordings();
  const idx = data.points.findIndex(p => p.name === name);
  if (idx === -1) {
    console.log(`❌ 找不到: ${name}`);
    return;
  }
  data.points.splice(idx, 1);
  saveRecordings(data);
  console.log(`✅ 已删除: ${name}`);
}

function testAll(): void {
  const data = loadRecordings();
  if (data.points.length === 0) {
    console.log('没有录制的点');
    return;
  }
  console.log('\n=== 测试所有点 ===\n');
  data.points.forEach((p, i) => {
    console.log(`${i + 1}. ${p.name}`);
    replayPoint(p.name);
  });
  console.log('\n✅ 测试完成');
}

// ============ 导出 ============

export {
  WindowRect,
  RecordedPoint,
  RecordingData,
  getWindowRect,
  listWindows,
  clickAt,
  calculateRatio,
  calculateScreenPos,
  loadRecordings,
  saveRecordings,
  recordPoint,
  replayPoint,
  listPoints,
  deletePoint,
  interactiveRecord,
  testAll
};

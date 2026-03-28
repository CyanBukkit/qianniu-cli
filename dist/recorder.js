"use strict";
/**
 * 坐标录制与回放模块
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
exports.getWindowRect = getWindowRect;
exports.listWindows = listWindows;
exports.clickAt = clickAt;
exports.calculateRatio = calculateRatio;
exports.calculateScreenPos = calculateScreenPos;
exports.loadRecordings = loadRecordings;
exports.saveRecordings = saveRecordings;
exports.recordPoint = recordPoint;
exports.replayPoint = replayPoint;
exports.listPoints = listPoints;
exports.deletePoint = deletePoint;
exports.interactiveRecord = interactiveRecord;
exports.testAll = testAll;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const readline = __importStar(require("readline"));
const RECORDINGS_FILE = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/recordings.json';
// ============ 工具函数 ============
function runScript(script) {
    const tmpFile = `/tmp/qianniu-rec-${Date.now()}.scpt`;
    fs.writeFileSync(tmpFile, script);
    try {
        return (0, child_process_1.execSync)(`osascript ${tmpFile}`, { timeout: 20000, encoding: 'utf8' }).trim();
    }
    finally {
        try {
            fs.unlinkSync(tmpFile);
        }
        catch { }
    }
}
function clickAt(x, y) {
    (0, child_process_1.execSync)(`cliclick c:${x},${y}`, { timeout: 5000 });
}
function getWindowRect(windowName, processName = 'Aliworkbench') {
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
    if (result === 'NOT_FOUND')
        return null;
    // 先按逗号分割，过滤空字符串，再解析数字
    const parts = result.split(',').filter(s => s.trim()).map(s => parseInt(s.trim(), 10));
    const [x, y, w, h] = parts;
    if (isNaN(x) || isNaN(y) || isNaN(w) || isNaN(h)) {
        console.error('解析窗口失败:', result);
        return null;
    }
    return { x, y, w, h };
}
function listWindows(processName = 'Aliworkbench') {
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
function calculateRatio(screenX, screenY, windowRect) {
    return {
        ratioX: (screenX - windowRect.x) / windowRect.w,
        ratioY: (screenY - windowRect.y) / windowRect.h
    };
}
function calculateScreenPos(ratioX, ratioY, windowRect) {
    return {
        x: Math.round(windowRect.x + ratioX * windowRect.w),
        y: Math.round(windowRect.y + ratioY * windowRect.h)
    };
}
// ============ 录制相关 ============
function loadRecordings() {
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
function saveRecordings(data) {
    fs.writeFileSync(RECORDINGS_FILE, JSON.stringify(data, null, 2));
}
function recordPoint(name) {
    console.log(`\n📌 录制点: ${name}`);
    console.log(`⏳ 10 秒内切换到千牛窗口，点击目标位置...`);
    console.log(`   (点击后自动完成录制)\n`);
    // 用 pynput 监听鼠标点击
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
        const result = (0, child_process_1.execSync)(`python3 -c '${script.replace(/'/g, "'\\''")}'`, { timeout: 15000, encoding: 'utf8' }).trim();
        const [screenX, screenY] = result.split(',').map(Number);
        console.log(`🖱️  点击位置: (${screenX}, ${screenY})`);
        // 自动检测点击位置属于哪个窗口
        const windows = listWindows();
        let targetWindow = null;
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
            }
            else {
                console.error('❌ 找不到任何窗口');
                return;
            }
        }
        const windowRect = targetWindow.rect;
        const windowName = targetWindow.name;
        console.log(`📐 窗口: ${windowName} (${windowRect.x}, ${windowRect.y}) ${windowRect.w}x${windowRect.h}`);
        const { ratioX, ratioY } = calculateRatio(screenX, screenY, windowRect);
        console.log(`📊 比例: (${ratioX.toFixed(4)}, ${ratioY.toFixed(4)})`);
        const data = loadRecordings();
        const existing = data.points.find(p => p.name === name);
        if (existing) {
            existing.ratioX = ratioX;
            existing.ratioY = ratioY;
            existing.recordedAt = new Date().toISOString();
            existing.windowName = windowName;
            console.log(`✅ 已更新: ${name}`);
        }
        else {
            data.points.push({ name, windowName, ratioX, ratioY, recordedAt: new Date().toISOString() });
            console.log(`✅ 已保存: ${name}`);
        }
        data.windowName = windowName;
        data.windowRect = windowRect;
        saveRecordings(data);
    }
    catch (e) {
        if (e.message.includes('pynput')) {
            console.log('⚠️  需要安装: pip3 install pynput');
        }
        else {
            console.error('❌ 录制失败:', e.message);
        }
    }
}
function interactiveRecord() {
    console.log('\n=== 录制模式 ===');
    console.log('输入点名称，切换到千牛窗口点击，输入 q 退出\n');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = () => {
        rl.question('点名称 (或 q): ', (name) => {
            if (name.toLowerCase() === 'q') {
                console.log('\n✅ 录制结束');
                listPoints();
                rl.close();
                return;
            }
            if (!name.trim()) {
                ask();
                return;
            }
            recordPoint(name.trim());
            ask();
        });
    };
    ask();
}
function replayPoint(name) {
    const data = loadRecordings();
    const point = data.points.find(p => p.name === name);
    if (!point) {
        console.error(`❌ 找不到: ${name}`);
        console.log(`已录制: ${data.points.map(p => p.name).join(', ') || '无'}`);
        return false;
    }
    const windowRect = getWindowRect(point.windowName);
    if (!windowRect) {
        console.error(`❌ 找不到窗口: ${point.windowName}`);
        return false;
    }
    const { x, y } = calculateScreenPos(point.ratioX, point.ratioY, windowRect);
    console.log(`📍 ${name}: 点击 (${x}, ${y})`);
    clickAt(x, y);
    return true;
}
function listPoints() {
    const data = loadRecordings();
    console.log(`\n窗口: ${data.windowName}`);
    console.log(`尺寸: ${data.windowRect.w}x${data.windowRect.h}`);
    console.log(`\n已录制 (${data.points.length} 个):`);
    data.points.forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.name} → (${p.ratioX.toFixed(4)}, ${p.ratioY.toFixed(4)})`);
    });
}
function deletePoint(name) {
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
function testAll() {
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

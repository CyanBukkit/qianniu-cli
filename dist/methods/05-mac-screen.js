"use strict";
/**
 * 方法五：mac-screen-capture
 *
 * 原理：mac-screen-capture 是专门为 macOS 设计的截图库，
 *       提供比 screencapture 更丰富的 API：
 *       - 枚举屏幕和窗口
 *       - 按窗口名/ID 截图
 *       - 支持 Retina 分辨率
 *       - 可指定保存格式和质量
 *
 * 配合 OCR 识别买家伙表 + 点击新买家读取聊天
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
exports.captureWindow = captureWindow;
exports.listWindowsNative = listWindowsNative;
exports.detect = detect;
exports.monitor = monitor;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
// ============ 模拟 mac-screen-capture 的核心功能 ============
// 由于 mac-screen-capture 需要编译原生模块，这里用纯 Node.js 实现等价功能
// 使用 screencapture + 系统调用模拟其核心 API
// 实际用 screencapture 枚举窗口（类似 mac-screen-capture 的 listWindows）
const LIST_WINDOWS_SCRIPT = `
-- 列出所有窗口，类似 mac-screen-capture.listWindows()
-- 使用 JXA (JavaScript for Automation)

ObjC.import('AppKit');

function getWindowList() {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  
  const workspace = $.NSWorkspace.sharedWorkspace;
  const windowList = $.NSMutableArray.array;
  
  const runningApps = workspace.runningApplications;
  const count = runningApps.count;
  
  const results = [];
  
  for (let i = 0; i < count; i++) {
    const app = runningApps.objectAtIndex(i);
    const appName = app.localizedName.js;
    
    if (appName.includes('Ali') || appName.includes('千牛') || appName.includes('旺旺')) {
      const windows = app.orderedWindows;
      if (windows) {
        const winCount = windows.count;
        for (let j = 0; j < winCount; j++) {
          const win = windows.objectAtIndex(j);
          const frame = win.frame;
          
          results.push({
            app: appName,
            title: win.title.js || appName,
            x: frame.origin.x,
            y: frame.origin.y,
            width: frame.size.width,
            height: frame.size.height,
            windowId: win.windowNumber
          });
        }
      }
    }
  }
  
  return JSON.stringify(results);
}

getWindowList();
`;
/**
 * 截取窗口/区域，类似 mac-screen-capture API
 */
function captureWindow(options) {
    const { x = 0, y = 0, width = 0, height = 0, windowId, outputPath = `/Users/liuyuxuanyi/.qclaw/workspace/tmp/qianniu-msc-${Date.now()}.png`, format = 'png' } = options;
    const ext = format === 'jpg' ? 'jpg' : format === 'tiff' ? 'tiff' : 'png';
    const out = outputPath.replace(/\\.[^.]+$/, `.${ext}`);
    try {
        fs.unlinkSync(out);
    }
    catch { }
    if (windowId) {
        // 按窗口ID截取（通过 screencapture -l windowId）
        const cmd = `screencapture -l ${windowId} ${out}`;
        (0, child_process_1.execSync)(cmd, { timeout: 8000 });
    }
    else if (width > 0 && height > 0) {
        // 按区域截取
        const cmd = `screencapture -R ${x},${y},${width},${height} ${out}`;
        (0, child_process_1.execSync)(cmd, { timeout: 8000 });
    }
    else {
        // 全屏
        (0, child_process_1.execSync)(`screencapture ${out}`, { timeout: 8000 });
    }
    return out;
}
/**
 * 列出所有窗口（类似 mac-screen-capture.listWindows()）
 */
function listWindowsNative() {
    try {
        const tmp = `/Users/liuyuxuanyi/.qclaw/workspace/tmp/qianniu-msc-list-${Date.now()}.sh`;
        const js = `
      ObjC.import('AppKit');
      const ws = $.NSWorkspace.sharedWorkspace;
      const apps = ws.runningApplications;
      const results = [];
      for (let i = 0; i < apps.count; i++) {
        const a = apps.objectAtIndex(i);
        const name = String(a.localizedName.js);
        if (name.includes('Ali') || name.includes('千牛') || name.includes('旺旺')) {
          const wins = a.orderedWindows;
          if (wins && wins.count > 0) {
            for (let j = 0; j < wins.count; j++) {
              const w = wins.objectAtIndex(j);
              const f = w.frame;
              results.push({
                app: name,
                title: String(w.title.js || name),
                x: f.origin.x,
                y: f.origin.y,
                width: f.size.width,
                height: f.size.height,
                windowId: w.windowNumber
              });
            }
          }
        }
      }
      JSON.stringify(results);
    `;
        fs.writeFileSync(tmp, js, 'utf8');
        const output = (0, child_process_1.execSync)(`osascript -l JavaScript ${tmp}`, { timeout: 10000, encoding: 'utf8' }).trim();
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
        return JSON.parse(output);
    }
    catch {
        return [];
    }
}
// ============ 检测函数 ============
function detect() {
    const timestamp = Date.now();
    // 1. 列出所有窗口
    const windows = listWindowsNative();
    // 2. 找接待中心窗口
    const receptionWin = windows.find(w => w.title.includes('接待中心') || w.title.includes('Aliworkbench'));
    if (!receptionWin) {
        return {
            buyers: [],
            newBuyer: null,
            messages: [],
            method: 'mac-screen-capture',
            timestamp,
            error: '接待中心窗口未找到'
        };
    }
    // 3. 截取接待中心整体
    const fullCapture = captureWindow({
        x: receptionWin.x,
        y: receptionWin.y,
        width: receptionWin.width,
        height: receptionWin.height,
        outputPath: `/Users/liuyuxuanyi/.qclaw/workspace/tmp/qianniu-msc-full-${timestamp}.png`
    });
    // 4. 截取买家伙表区域（接待中心左侧，约左侧 1/4）
    const listCapture = captureWindow({
        x: receptionWin.x,
        y: receptionWin.y,
        width: Math.round(receptionWin.width * 0.25),
        height: receptionWin.height,
        outputPath: `/Users/liuyuxuanyi/.qclaw/workspace/tmp/qianniu-msc-list-${timestamp}.png`
    });
    // 5. OCR 识别买家伙表
    let ocrText = '';
    try {
        ocrText = (0, child_process_1.execSync)(`tesseract ${listCapture} stdout -l chi_sim+eng --psm 6 2>/dev/null`, { timeout: 20000, encoding: 'utf8' }).trim();
    }
    catch {
        ocrText = '';
    }
    // 6. 解析买家名称
    const buyers = parseBuyerList(ocrText, receptionWin);
    // 清理临时文件
    try {
        fs.unlinkSync(fullCapture);
    }
    catch { }
    try {
        fs.unlinkSync(listCapture);
    }
    catch { }
    // 7. 检测新买家（有红点标记的）
    // 新买家通常出现在列表顶部
    const newBuyer = buyers.length > 0 ? buyers[0] : null;
    // 8. 如果有新买家，截取聊天区域并读取消息
    const messages = [];
    if (newBuyer) {
        // 点击买家头像
        try {
            (0, child_process_1.execSync)(`cliclick c:${newBuyer.x + 60},${newBuyer.y + 20}`, { timeout: 3000 });
            (0, child_process_1.execSync)('sleep 0.8', { encoding: 'utf8' });
        }
        catch { }
        // 截取聊天区域（接待中心右侧）
        const chatCapture = captureWindow({
            x: receptionWin.x + Math.round(receptionWin.width * 0.28),
            y: receptionWin.y + 50,
            width: Math.round(receptionWin.width * 0.72),
            height: receptionWin.height - 100,
            outputPath: `/Users/liuyuxuanyi/.qclaw/workspace/tmp/qianniu-msc-chat-${timestamp}.png`
        });
        try {
            const chatOcr = (0, child_process_1.execSync)(`tesseract ${chatCapture} stdout -l chi_sim+eng --psm 6 2>/dev/null`, { timeout: 20000, encoding: 'utf8' }).trim();
            const lines = chatOcr.split('\\n').filter(l => l.trim().length > 2);
            for (const line of lines) {
                const clean = line.trim();
                if (clean.length > 1) {
                    messages.push({
                        sender: clean.includes('客服') || clean.includes('我:') ? 'seller' : 'buyer',
                        text: clean
                    });
                }
            }
        }
        catch { }
        try {
            fs.unlinkSync(chatCapture);
        }
        catch { }
    }
    return {
        buyers,
        newBuyer,
        messages,
        method: 'mac-screen-capture',
        timestamp
    };
}
// ============ 解析买家列表 ============
function parseBuyerList(ocrText, win) {
    const buyers = [];
    const seen = new Set();
    const lines = ocrText.split('\\n').filter(l => l.trim().length > 0);
    // 买家伙表在接待中心左侧，y 坐标从顶部开始
    // 每一项大约间隔 50-80 像素
    const listStartY = win.y + 60;
    const itemHeight = 60;
    let idx = 0;
    for (const line of lines) {
        const clean = line.replace(/\\s+/g, '').trim();
        // 过滤：太短/太长的不是买家名
        if (clean.length < 2 || clean.length > 20)
            continue;
        // 过滤纯数字/英文/网址
        if (/^[a-zA-Z0-9\\.\-_:]+$/.test(clean))
            continue;
        if (clean.includes('http') || clean.includes('www') || clean.includes('.com'))
            continue;
        // 过滤时间类
        if (/\\d{1,2}:\\d{2}/.test(clean))
            continue;
        if (!seen.has(clean)) {
            seen.add(clean);
            buyers.push({
                name: clean,
                x: win.x + 10,
                y: listStartY + idx * itemHeight,
                screenId: 0,
                windowId: win.windowId
            });
            idx++;
        }
        if (buyers.length >= 10)
            break;
    }
    return buyers;
}
// ============ 轮询 ============
let lastCount = 0;
function monitor(callback, intervalMs = 5000) {
    console.log('[mac-screen] 🔍 启动 mac-screen-capture 监听（每', intervalMs / 1000, '秒）');
    return setInterval(() => {
        const result = detect();
        if (result.error) {
            console.log(`[mac-screen] [${new Date().toLocaleTimeString()}] ${result.error}`);
        }
        else if (result.buyers.length !== lastCount) {
            console.log(`[mac-screen] [${new Date().toLocaleTimeString()}] 检测到 ${result.buyers.length} 个买家`);
            result.buyers.forEach((b, i) => {
                console.log(`  ${i + 1}. ${b.name}`);
            });
            lastCount = result.buyers.length;
        }
        callback(result);
    }, intervalMs);
}
// ============ CLI ============
if (require.main === module) {
    console.log('=== 方法五：mac-screen-capture ===\n');
    // 检查窗口
    const windows = listWindowsNative();
    console.log(`🪟 检测到 ${windows.length} 个阿里系窗口:`);
    windows.forEach(w => {
        console.log(`  ${w.title} (id=${w.windowId}) @(${w.x},${w.y}) ${w.width}x${w.height}`);
    });
    console.log('');
    const result = detect();
    console.log(`检测时间: ${new Date(result.timestamp).toLocaleString()}`);
    console.log(`买家数量: ${result.buyers.length}`);
    if (result.error) {
        console.log(`错误: ${result.error}`);
    }
    result.buyers.forEach((b, i) => {
        console.log(`  ${i + 1}. ${b.name}`);
    });
    if (result.messages.length > 0) {
        console.log('\n💬 最新消息:');
        result.messages.slice(-5).forEach(m => {
            console.log(`  [${m.sender}] ${m.text.slice(0, 60)}`);
        });
    }
}

"use strict";
/**
 * 方法三：AppleScript CGWindowListCopyWindowInfo
 *
 * 原理：使用 CGWindowListCopyWindowInfo API 获取窗口层信息
 *       结合 System Events 深度遍历窗口内容
 *
 * 特点：
 *   - 不依赖 Accessibility 权限（AXUIElement 需要授权）
 *   - 可以获取窗口层级、窗口名、可见区域
 *   - 结合 OCR 做文字识别
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
exports.detect = detect;
exports.monitor = monitor;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
// ============ CGWindowList API - 获取窗口列表 ============
const CGWINDOW_LIST_SCRIPT = `
-- 通过 CGWindowListCopyWindowInfo 获取窗口列表
-- 无需辅助功能权限
use framework "Foundation"
use framework "AppKit"

set winList to ""
set theBounds to current application's CGWindowListCopyWindowInfo_(current application's kCGWindowListOptionOnScreenOnly, current application's kCGNullWindowID)

set winArray to theBounds as list

repeat with i from 1 to length of winArray
  set winDict to item i of winArray
  
  -- 获取窗口所属应用
  set ownerName to ""
  try
    set ownerName to owner's name of winDict as string
  end try
  
  -- 只处理阿里系应用
  if ownerName contains "Ali" or ownerName contains "千牛" or ownerName contains "旺旺" then
    set winNum to window_number of winDict
    set bounds to bounds of winDict
    set layer to layer of winDict
    
    -- bounds 格式: {x, y, w, h} 但需要转换
    set bx to item 1 of bounds
    set by to item 2 of bounds
    set bw to item 3 of bounds - bx
    set bh to item 4 of bounds - by
    
    set winName to ""
    try
      set winName to window_name of winDict as string
    on error
      set winName to ""
    end try
    
    set winList to winList & ownerName & "│" & winName & "│" & winNum & "│" & layer & "│" & bx & "," & by & "," & bw & "," & bh & ";;"
  end if
end repeat

return winList
`;
// ============ 接待中心 UI 遍历脚本 ============
const RECEPTION_SCRIPT = `
tell application "System Events"
  tell process "Aliworkbench"
    set out to ""
    
    -- 方法1：遍历所有窗口
    repeat with wi from 1 to count of windows
      set wName to name of window wi
      if wName contains "接待中心" then
        set wPos to position of window wi
        set wSize to size of window wi
        
        set out to out & "WIN│" & wName & "│" & (item 1 of wPos) & "," & (item 2 of wPos) & "," & (item 1 of wSize) & "," & (item 2 of wSize) & "\\n"
        
        -- 获取窗口内所有元素
        tell window wi
          on deepGet(elem, indent)
            set info to ""
            try
              set er to role of elem as string
              set en to name of elem as string
              set ev to value of elem as string
              set ep to position of elem
              set es to size of elem
              
              if er is not missing value and en is not missing value then
                if er is "AXStaticText" and en is not "" and length of en > 0 then
                  set info to info & indent & "TXT│" & en & "│" & (item 1 of ep) & "," & (item 2 of ep) & "\\n"
                end if
              end if
              
              -- 只向下2层
              if indent length < 8 then
                try
                  set childResults to ""
                  set childCount to count of UI elements of elem
                  repeat with ci from 1 to min(childCount, 10)
                    set childInfo to deepGet(UI element ci of elem, indent & "  ")
                    set childResults to childResults & childInfo
                  end repeat
                  set info to info & childResults
                on error
                end try
              end if
            on error
            end try
            return info
          end deepGet
          
          -- 从 group 1 开始
          try
            set elemInfo to deepGet(window wi, "")
            set out to out & elemInfo
          on error
          end try
        end tell
      end if
    end repeat
    
    return out
  end tell
end tell
`;
// ============ 解析 CGWindow 结果 ============
function parseCGWindowList(output) {
    const buyers = [];
    if (!output || output.trim() === '')
        return buyers;
    const entries = output.split(';;').filter(e => e.trim());
    for (const entry of entries) {
        const parts = entry.split('│');
        if (parts.length < 5)
            continue;
        const [ownerName, winName, winNum, layer, coords] = parts;
        if (!ownerName)
            continue;
        const [x, y, w, h] = coords.split(',').map(Number);
        // 判断是否是接待中心窗口（买家伙表在左侧，x 较小）
        if (winName && winName.includes('接待中心') && x < 100) {
            buyers.push({
                name: winName,
                x, y, w, h,
                layer: Number(layer) || 0,
                windowNumber: Number(winNum) || 0
            });
        }
    }
    return buyers;
}
// ============ 解析接待中心买家 ============
function parseReceptionList(output) {
    const buyers = [];
    let windowBounds = null;
    const lines = output.split('\\n').filter(l => l.trim());
    const nameSet = new Set();
    for (const line of lines) {
        const parts = line.split('│');
        if (parts.length < 3)
            continue;
        const [type, ...rest] = parts;
        if (type === 'WIN' && rest.length >= 2) {
            const coords = rest[0].split(',').map(Number);
            const [w, h] = coords.slice(2);
            windowBounds = { x: coords[0], y: coords[1], w, h };
        }
        if (type === 'TXT') {
            const text = rest[0]?.trim();
            const coordsStr = rest[rest.length - 1];
            if (!text || !coordsStr)
                continue;
            const [px, py] = coordsStr.split(',').map(Number);
            // 买家伙表区域：左侧，x < 250
            if (px > 0 && px < 250 && py > 50 && text.length > 0 && text.length < 30) {
                const clean = text.replace(/\\s+/g, '').trim();
                if (clean && !nameSet.has(clean)) {
                    nameSet.add(clean);
                    buyers.push({
                        name: clean,
                        x: px,
                        y: py,
                        w: 0,
                        h: 0,
                        layer: 0,
                        windowNumber: 0
                    });
                }
            }
        }
    }
    // 按 y 排序
    buyers.sort((a, b) => a.y - b.y);
    return { buyers, windowBounds };
}
// ============ 读取聊天消息 ============
function readChatByCGWindow() {
    // 截图聊天区域，用 OCR 读文字
    // 这里结合 screencapture + tesseract
    const tmpImg = `/Users/liuyuxuanyi/.qclaw/workspace/tmp/qianniu-chat-${Date.now()}.png`;
    try {
        // 截图接待中心右侧聊天区域（粗略）
        // 假设接待中心在 (0, 53)，宽度约 1310
        (0, child_process_1.execSync)(`screencapture -R 280,100,900,600 ${tmpImg}`, { timeout: 5000 });
        // OCR
        const ocrResult = (0, child_process_1.execSync)(`tesseract ${tmpImg} stdout -l chi_sim+eng --psm 6 2>/dev/null`, { timeout: 20000, encoding: 'utf8' }).trim();
        try {
            fs.unlinkSync(tmpImg);
        }
        catch { }
        if (!ocrResult || ocrResult === 'TESSERACT_NOT_INSTALLED') {
            return [];
        }
        const messages = [];
        const lines = ocrResult.split('\\n').filter(l => l.trim().length > 2);
        for (const line of lines) {
            const clean = line.trim();
            if (clean.length > 1) {
                messages.push({
                    sender: clean.includes('客服') || clean.includes('我:') ? 'seller' : 'buyer',
                    text: clean
                });
            }
        }
        return messages;
    }
    catch {
        try {
            fs.unlinkSync(tmpImg);
        }
        catch { }
        return [];
    }
}
// ============ 主检测函数 ============
function detect() {
    const timestamp = Date.now();
    // 1. CGWindowList 快速扫描
    let cgWindows = '';
    try {
        const tmp = `/tmp/qianniu-cgwin-${timestamp}.scpt`;
        fs.writeFileSync(tmp, CGWINDOW_LIST_SCRIPT, 'utf8');
        cgWindows = (0, child_process_1.execSync)(`osascript ${tmp}`, { timeout: 8000, encoding: 'utf8' }).trim();
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
    }
    catch {
        cgWindows = '';
    }
    // 2. 接待中心深度遍历
    let receptionInfo = '';
    try {
        const tmp = `/tmp/qianniu-reception-${timestamp}.scpt`;
        fs.writeFileSync(tmp, RECEPTION_SCRIPT, 'utf8');
        receptionInfo = (0, child_process_1.execSync)(`osascript ${tmp}`, { timeout: 8000, encoding: 'utf8' }).trim();
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
    }
    catch {
        receptionInfo = '';
    }
    const cgBuyers = parseCGWindowList(cgWindows);
    const { buyers: axBuyers } = parseReceptionList(receptionInfo);
    // 合并：CGWindow 提供窗口位置，接待中心提供买家名称
    const allBuyers = [...cgBuyers];
    for (const b of axBuyers) {
        if (!allBuyers.find(existing => Math.abs(existing.x - b.x) < 20 && Math.abs(existing.y - b.y) < 20)) {
            allBuyers.push(b);
        }
    }
    // 点击第一个买家读取聊天
    const messages = readChatByCGWindow();
    return {
        buyers: allBuyers.slice(0, 8),
        newBuyer: allBuyers.find(b => b.name?.includes('接待中心')) || null,
        messages,
        rawWindows: cgWindows ? cgWindows.split(';;').filter(Boolean) : [],
        method: 'applescript-cgwin',
        timestamp
    };
}
// ============ 轮询监听 ============
function monitor(callback, intervalMs = 5000) {
    console.log('[CGWindow] 🔍 启动 CGWindowList 监听（每', intervalMs / 1000, '秒）');
    let prevCount = 0;
    return setInterval(() => {
        const result = detect();
        if (result.buyers.length !== prevCount) {
            console.log(`[CGWindow] [${new Date().toLocaleTimeString()}] 新检测到 ${result.buyers.length} 个窗口/买家`);
            result.buyers.forEach(b => {
                console.log(`  ${b.name} @(${b.x},${b.y}) layer=${b.layer}`);
            });
            prevCount = result.buyers.length;
        }
        callback(result);
    }, intervalMs);
}
// ============ CLI ============
if (require.main === module) {
    console.log('=== 方法三：AppleScript CGWindowList ===\n');
    const result = detect();
    console.log(`检测时间: ${new Date(result.timestamp).toLocaleString()}`);
    console.log(`CGWindow 窗口: ${result.rawWindows.length} 个`);
    console.log(`接待中心买家: ${result.buyers.length} 个\n`);
    if (result.rawWindows.length > 0) {
        console.log('🪟 CGWindow 列表:');
        result.rawWindows.slice(0, 5).forEach(w => {
            const parts = w.split('│');
            if (parts.length >= 5) {
                console.log(`  ${parts[0]} | ${parts[1]} | layer=${parts[3]} | ${parts[4]}`);
            }
        });
    }
    console.log('\n👥 买家列表:');
    result.buyers.forEach((b, i) => {
        console.log(`  ${i + 1}. ${b.name} @(${b.x},${b.y})`);
    });
    if (result.messages.length > 0) {
        console.log('\n💬 聊天消息:');
        result.messages.slice(-5).forEach(m => {
            console.log(`  [${m.sender}] ${m.text.slice(0, 60)}`);
        });
    }
}

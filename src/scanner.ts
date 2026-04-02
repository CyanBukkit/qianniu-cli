/**
 * 接待中心买家扫描模块
 * 基于已知位置计算偏移量，自动探测所有待回复买家
 */

import { execSync } from 'child_process';
import { screenshot } from './clipboard';

// 接待中心窗口（硬编码，可通过 listWindows 动态获取）
const RECEPTION = {
  windowName: 't_1487330154436_074-接待中心',
  x: 0,
  y: 53,
  w: 1310,
  h: 800
};

// 已知的两个买家位置（录制得到）
const KNOWN_POINTS = [
  { name: '待回复买家1', ratioX: 0.13563931297709925, ratioY: 0.3717333984375 },
  { name: '待回复买家2', ratioX: 0.1477278148854962, ratioY: 0.438525390625 }
];

// 计算偏移量
function calcOffset() {
  const dx = KNOWN_POINTS[1].ratioX - KNOWN_POINTS[0].ratioX;
  const dy = KNOWN_POINTS[1].ratioY - KNOWN_POINTS[0].ratioY;
  return { dx, dy };
}

// 根据已知位置计算第 N 个买家的比例坐标
function calcBuyerRatio(index: number): { ratioX: number; ratioY: number } {
  const { dx, dy } = calcOffset();
  const base = KNOWN_POINTS[0];
  return {
    ratioX: base.ratioX + index * dx,
    ratioY: base.ratioY + index * dy
  };
}

// 比例坐标转屏幕坐标
function ratioToScreen(ratioX: number, ratioY: number): { x: number; y: number } {
  return {
    x: Math.round(RECEPTION.x + ratioX * RECEPTION.w),
    y: Math.round(RECEPTION.y + ratioY * RECEPTION.h)
  };
}

// 通过 AX API 获取买家的买家名称
function getBuyerName(screenX: number, screenY: number): string | null {
  // 点击头像选中该买家
  execSync(`cliclick c:${screenX},${screenY}`, { timeout: 3000 });
  execSync('sleep 0.3');

  // 用 AX API 读取买家名称
  const script = `
    tell application "System Events"
      tell process "Aliworkbench"
        -- 获取焦点窗口
        set frontWindow to front window
        
        -- 尝试获取当前选中的买家名称
        -- 通常在接待中心右侧会有一个详情区域
        try
          -- 方式1: 获取窗口名称
          set windowName to name of frontWindow
          
          -- 方式2: 遍历 UI 元素找买家名称
          set elemName to ""
          tell frontWindow
            -- 尝试获取群组或静态文本
            repeat with i from 1 to 5
              try
                set g to group i
                repeat with j from 1 to 3
                  try
                    set txt to static text j of g
                    set t to value of txt
                    if t is not "" then
                      set elemName to elemName & t & "|"
                    end if
                  end try
                end repeat
              end try
            end repeat
          end tell
          
          return windowName & "||" & elemName
        on error
          return "ERROR"
        end try
      end tell
    end tell
  `;

  try {
    const result = execSync(`osascript -e '${script}'`, { timeout: 5000, encoding: 'utf8' }).trim();
    return result;
  } catch {
    return null;
  }
}

// 用 AX API 扫描接待中心的所有买家
function scanBuyerListWithAX(): Array<{ index: number; x: number; y: number; name: string }> {
  const script = `
    tell application "System Events"
      tell process "Aliworkbench"
        set out to ""
        repeat with i from 1 to count of windows
          set n to name of window i
          if n contains "接待中心" then
            tell window i
              try
                set g1 to group 1
                set axg to UI element 1 of g1
                
                repeat with j from 1 to count of UI elements of axg
                  try
                    set elem to UI element j of axg
                    set nm to name of elem
                    set pos to position of elem
                    set sz to size of elem
                    
                    if nm is not missing value and nm is not "" then
                      set out to out & nm & "|" & (item 1 of pos) & "," & (item 2 of pos) & ";"
                    end if
                  end try
                end repeat
              on error
                set out to "ERROR"
              end try
            end tell
          end if
        end repeat
        return out
      end tell
    end tell
  `;

  try {
    const result = execSync(`osascript -e '${script}'`, { timeout: 5000, encoding: 'utf8' }).trim();
    if (result === 'ERROR' || !result) return [];

    return result.split(';').filter(Boolean).map((seg, idx) => {
      const [name, coords] = seg.split('|');
      const [x, y] = coords.split(',').map(Number);
      return {
        index: idx,
        x,
        y,
        name: name || `买家${idx + 1}`
      };
    });
  } catch {
    return [];
  }
}

// 主扫描函数
export function scanAllBuyers(): Array<{ index: number; name: string; screenX: number; screenY: number; hasNewMessage: boolean }> {
  console.log('🔍 扫描接待中心买家...\n');

  // 方法1: 用已知位置计算
  const { dx, dy } = calcOffset();
  console.log(`📐 偏移量: dx=${dx.toFixed(4)}, dy=${dy.toFixed(4)}\n`);

  const buyers: Array<{ index: number; name: string; screenX: number; screenY: number; hasNewMessage: boolean }> = [];

  // 计算前4个买家位置
  for (let i = 0; i < 4; i++) {
    const ratio = calcBuyerRatio(i);
    const { x, y } = ratioToScreen(ratio.ratioX, ratio.ratioY);
    buyers.push({
      index: i + 1,
      name: `待检测`,
      screenX: x,
      screenY: y,
      hasNewMessage: false // 待检测
    });
  }

  // 尝试用 AX API 获取买家名称
  console.log('🖥️  获取买家信息...\n');
  const axBuyers = scanBuyerListWithAX();
  console.log(`发现 ${axBuyers.length} 个 UI 元素`);

  // 结合两者
  axBuyers.forEach((ax, idx) => {
    if (idx < buyers.length) {
      buyers[idx].name = ax.name;
      buyers[idx].screenX = ax.x;
      buyers[idx].screenY = ax.y;
    }
  });

  return buyers;
}

// 命令行测试
if (require.main === module) {
  console.log('=== 接待中心买家扫描测试 ===\n');

  const buyers = scanAllBuyers();

  console.log('\n📋 买家列表:');
  console.log('─'.repeat(50));
  buyers.forEach(b => {
    console.log(`${b.index}. ${b.name}`);
    console.log(`   屏幕位置: (${b.screenX}, ${b.screenY})`);
  });
}

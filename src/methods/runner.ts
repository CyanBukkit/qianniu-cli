/**
 * 五种方案统一运行器
 * 
 * 同时启动 5 种不同的窗口检测方法，对比输出结果
 * 
 * 用法:
 *   npx ts-node src/methods/runner.ts [method1,method2,...] [interval]
 *   
 * 示例:
 *   npx ts-node src/methods/runner.ts all 5        # 运行全部，每5秒
 *   npx ts-node src/methods/runner.ts ax-ui 3      # 只跑 AXUIElement，每3秒
 *   npx ts-node src/methods/runner.ts ax-ui,electron-dc 5  # 跑指定的
 */

import { detect as detectAXUI } from './01-ax-ui';
import { detectByElectron } from './02-electron-dc';
import { detect as detectCGWin } from './03-applescript-cgwin';
import { detect as detectPlaywright } from './04-playwright-dc';
import { detect as detectMacScreen } from './05-mac-screen';

type MethodKey = 'ax-ui' | 'electron-dc' | 'applescript-cgwin' | 'playwright-dc' | 'mac-screen-capture';

const METHODS: Record<MethodKey, () => any> = {
  'ax-ui': () => detectAXUI(),
  'electron-dc': () => detectByElectron(),
  'applescript-cgwin': () => detectCGWin(),
  'playwright-dc': () => detectPlaywright(),
  'mac-screen-capture': () => detectMacScreen(),
};

const METHOD_NAMES: Record<MethodKey, string> = {
  'ax-ui': '① AXUIElement API',
  'electron-dc': '② Electron desktopCapturer',
  'applescript-cgwin': '③ AppleScript CGWindowList',
  'playwright-dc': '④ Playwright desktopCapturer',
  'mac-screen-capture': '⑤ mac-screen-capture',
};

// ============ 彩色输出 ============

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function color(c: keyof typeof COLORS, text: string): string {
  return `${COLORS[c]}${text}${COLORS.reset}`;
}

function printBanner() {
  console.log(color('cyan', `
╔══════════════════════════════════════════════╗
║    千牛自动化 · 五种窗口检测方案对比运行器     ║
╚══════════════════════════════════════════════╝
  `));
}

function printResult(key: MethodKey, result: any) {
  const name = METHOD_NAMES[key];
  const prefix = color('bright', `[${name}]`);
  
  console.log(`\n${color('yellow', '─'.repeat(50))}`);
  console.log(`${prefix} ${color('bright', new Date(result.timestamp).toLocaleString())}`);
  
  if (result.error) {
    console.log(`  ${color('red', '✗')} 错误: ${result.error}`);
    return;
  }
  
  const buyerCount = result.buyers?.length ?? 0;
  const msgCount = result.messages?.length ?? 0;
  
  console.log(`  ${color('green', '✓')} 买家: ${buyerCount} 个`);
  
  if (result.newBuyer) {
    console.log(`  ${color('magenta', '🆕')} 新买家: ${result.newBuyer.name}`);
  }
  
  if (result.messages && result.messages.length > 0) {
    console.log(`  💬 消息 ${msgCount} 条:`);
    result.messages.slice(-3).forEach((m: any) => {
      const tag = m.sender === 'buyer' ? color('cyan', '[买家]') : color('green', '[客服]');
      console.log(`    ${tag} ${m.text.slice(0, 50)}`);
    });
  }
  
  // 方法特有的额外信息
  if (key === 'electron-dc' && result.windowThumbnail) {
    console.log(`  📸 缩略图: 已捕获`);
  }
  if (key === 'applescript-cgwin' && result.rawWindows?.length > 0) {
    console.log(`  🪟 CGWindow 窗口: ${result.rawWindows.length} 个`);
  }
}

// ============ 单次运行 ============

async function runOnce(selected: MethodKey[]) {
  printBanner();
  console.log(color('bright', `\n检测时间: ${new Date().toLocaleString()}`));
  console.log(`运行方法: ${selected.map(k => METHOD_NAMES[k]).join(' | ')}\n`);
  
  const promises = selected.map(async (key) => {
    try {
      const detect = METHODS[key];
      const result = await (key === 'electron-dc' ? detect() : detect());
      printResult(key, result);
      return { key, result };
    } catch (e: any) {
      printResult(key, { error: e.message, timestamp: Date.now() });
      return { key, result: null };
    }
  });
  
  await Promise.all(promises);
}

// ============ 轮询运行 ============

let pollCounters: Record<MethodKey, number> = {
  'ax-ui': 0,
  'electron-dc': 0,
  'applescript-cgwin': 0,
  'playwright-dc': 0,
  'mac-screen-capture': 0,
};

async function runPoll(selected: MethodKey[], intervalSec: number) {
  printBanner();
  console.log(color('bright', `\n轮询模式: 每 ${intervalSec} 秒检测一次`));
  console.log(`运行方法: ${selected.map(k => METHOD_NAMES[k]).join(' | ')}`);

  // 首次运行
  await runOnce(selected);
  
  const intervalMs = intervalSec * 1000;
  
  // 每种方法独立的计时器
  for (const key of selected) {
    setInterval(async () => {
      try {
        const detect = METHODS[key];
        const result = await (key === 'electron-dc' ? detect() : detect());
        
        const prev = pollCounters[key];
        pollCounters[key]++;
        
        // 只在有新发现时打印
        const hasNew = result.newBuyer || 
                       (result.buyers && result.buyers.length !== prev);
        
        if (hasNew || pollCounters[key] % 5 === 0) {
          console.log(color('bright', `\n[${METHOD_NAMES[key]}] 轮询 #${pollCounters[key]}`));
          printResult(key, result);
        }
      } catch (e: any) {
        console.log(`[${METHOD_NAMES[key]}] ${color('red', '✗')} ${e.message}`);
      }
    }, intervalMs);
  }
  
  // 保持进程
  console.log(color('cyan', `\n监听中... 按 Ctrl+C 停止\n`));
}

// ============ CLI ============

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
用法:
  npx ts-node src/methods/runner.ts [模式] [间隔秒数]

模式:
  all          运行全部 5 种方法
  ax-ui        只运行 AXUIElement API
  electron-dc  只运行 Electron desktopCapturer
  cgwin        只运行 AppleScript CGWindowList
  playwright   只运行 Playwright desktopCapturer
  mac-screen   只运行 mac-screen-capture

示例:
  npx ts-node src/methods/runner.ts all 5        # 全部，每5秒
  npx ts-node src/methods/runner.ts ax-ui,mac-screen 10  # 两种，每10秒
  npx ts-node src/methods/runner.ts ax-ui        # 单次运行 AXUIElement
  `);
  process.exit(0);
}

const mode = args[0];
const interval = parseInt(args[1] || '0', 10);

// 解析方法
let selected: MethodKey[];

if (mode === 'all') {
  selected = ['ax-ui', 'electron-dc', 'applescript-cgwin', 'playwright-dc', 'mac-screen-capture'];
} else {
  const map: Record<string, MethodKey> = {
    'ax-ui': 'ax-ui',
    'electron-dc': 'electron-dc',
    'cgwin': 'applescript-cgwin',
    'applescript': 'applescript-cgwin',
    'playwright': 'playwright-dc',
    'playwright-dc': 'playwright-dc',
    'mac-screen': 'mac-screen-capture',
    'mac-screen-capture': 'mac-screen-capture',
  };
  
  const key = map[mode];
  if (!key) {
    console.error(`未知模式: ${mode}`);
    process.exit(1);
  }
  selected = [key];
}

// 启动
if (interval > 0) {
  runPoll(selected, interval);
} else {
  runOnce(selected).then(() => {
    console.log(color('green', '\n✓ 检测完成\n'));
    process.exit(0);
  });
}

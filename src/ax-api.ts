/**
 * AXUIElement API 封装
 * macOS 无障碍 API 的 TypeScript 封装
 */

import { execSync } from 'child_process';

// ==================== 工具函数 ====================

function runScript(script: string): string {
  const tmpFile = `/tmp/qianniu-ax-${Date.now()}.scpt`;
  require('fs').writeFileSync(tmpFile, script);
  try {
    return execSync(`osascript ${tmpFile}`, { timeout: 10000, encoding: 'utf8' }).trim();
  } finally {
    try { require('fs').unlinkSync(tmpFile); } catch {}
  }
}

// ==================== 买家列表 ====================

export interface Buyer {
  name: string;
  x: number;
  y: number;
}

/**
 * 获取接待中心当前买家列表
 */
export function getBuyerList(): Buyer[] {
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

  const result = runScript(script);
  if (!result || result === 'ERROR') return [];

  return result.split(';').filter(Boolean).map((seg, idx) => {
    const [name, coords] = seg.split('|');
    const [x, y] = coords.split(',').map(Number);
    return { name: name || `买家${idx + 1}`, x, y };
  });
}

/**
 * 点击买家头像
 */
export function clickBuyer(x: number, y: number): void {
  execSync(`cliclick c:${x},${y}`, { timeout: 3000 });
  execSync('sleep 0.5');
}

// ==================== 聊天消息 ====================

export interface ChatMessage {
  sender: 'buyer' | 'seller' | 'system';
  text: string;
}

/**
 * 获取聊天消息（从聊天区域）
 */
export function getChatMessages(): ChatMessage[] {
  const script = `
    tell application "System Events"
      tell process "Aliworkbench"
        set out to ""
        repeat with i from 1 to count of windows
          set n to name of window i
          if n contains "接待中心" then
            tell window i
              -- 获取所有静态文本
              repeat with j from 1 to count of static texts
                try
                  set txt to static text j
                  set txtVal to value of txt
                  set txtPos to position of txt
                  -- 过滤掉UI元素文字，只保留聊天内容（位置在消息区域）
                  if txtVal is not missing value and length of (txtVal as string) > 1 then
                    set px to item 1 of txtPos
                    set py to item 2 of txtPos
                    -- 消息区域通常在窗口中间位置 (x > 260 and y > 100)
                    if px > 260 and py > 100 then
                      set out to out & txtVal & "|||"
                    end if
                  end if
                end try
              end repeat
            end tell
          end if
        end repeat
        return out
      end tell
    end tell
  `;

  const result = runScript(script);
  if (!result) return [];

  const texts = result.split('|||').filter(t => t.trim().length > 0);
  
  // 解析消息（需要区分买家/卖家）
  return texts.map(text => {
    // 简单判断：如果文字是"买家:"开头或类似格式，标记为对应sender
    // 这里暂时全部标记为 buyer，后续可以改进
    const cleanText = text.trim();
    if (cleanText.includes('客服:') || cleanText.includes('我:')) {
      return { sender: 'seller' as const, text: cleanText };
    }
    return { sender: 'buyer' as const, text: cleanText };
  });
}

/**
 * 获取买家的聊天消息（通过 AXTextArea）
 */
export function getChatMessagesFromTextArea(): ChatMessage[] {
  const script = `
    tell application "System Events"
      tell process "Aliworkbench"
        set out to ""
        repeat with i from 1 to count of windows
          set n to name of window i
          if n contains "接待中心" then
            tell window i
              -- 遍历所有文本区域
              repeat with elem in (get every UI element)
                try
                  set elemRole to role of elem as string
                  if elemRole is "AXTextArea" or elemRole is "AXScrollArea" then
                    set elemValue to value of elem as string
                    if elemValue is not missing value and length of elemValue > 0 then
                      set elemPos to position of elem
                      set px to item 1 of elemPos
                      set py to item 2 of elemPos
                      -- 消息区域在右侧
                      if px > 260 then
                        set out to out & "MSG:" & elemValue & "|||POS:" & px & "," & py & ";;;"
                      end if
                    end if
                  end if
                end try
              end repeat
            end tell
          end if
        end repeat
        return out
      end tell
    end tell
  `;

  const result = runScript(script);
  if (!result) return [];

  const messages: ChatMessage[] = [];
  const blocks = result.split(';;;').filter(Boolean);
  
  for (const block of blocks) {
    const msgMatch = block.match(/MSG:(.+?)\|\|\|POS:/);
    const posMatch = block.match(/POS:(\d+),(\d+)/);
    if (msgMatch) {
      const text = msgMatch[1].trim();
      if (text.length > 0) {
        messages.push({
          sender: 'buyer',
          text
        });
      }
    }
  }

  return messages;
}

/**
 * 获取指定坐标的元素文本（用于点击后获取聊天内容）
 */
export function getTextAtPosition(x: number, y: number): string {
  const script = `
    tell application "System Events"
      tell process "Aliworkbench"
        set out to ""
        repeat with i from 1 to count of windows
          set n to name of window i
          if n contains "接待中心" then
            tell window i
              repeat with elem in (get every UI element)
                try
                  set elemPos to position of elem
                  set elemSize to size of elem
                  set px to item 1 of elemPos
                  set py to item 2 of elemPos
                  set sx to item 1 of elemSize
                  set sy to item 2 of elemSize
                  
                  -- 检查点是否在元素范围内
                  if px <= ${x} and px + sx >= ${x} and py <= ${y} and py + sy >= ${y} then
                    set elemValue to value of elem as string
                    if elemValue is not missing value and length of elemValue > 0 then
                      set out to elemValue
                      exit repeat
                    end if
                  end if
                end try
              end repeat
            end tell
          end if
        end repeat
        return out
      end tell
    end tell
  `;

  const result = runScript(script);
  return result || '';
}

// ==================== 发送消息 ====================

/**
 * 发送文本消息
 */
export function sendMessage(text: string): boolean {
  // 先复制到剪贴板
  execSync(`echo '${text.replace(/'/g, "\\'")}' | pbcopy`, { timeout: 3000 });
  
  // 聚焦到输入框并粘贴
  const script = `
    tell application "System Events"
      tell process "Aliworkbench"
        repeat with i from 1 to count of windows
          set n to name of window i
          if n contains "接待中心" then
            tell window i
              repeat with elem in (get every UI element)
                try
                  set elemRole to role of elem as string
                  if elemRole is "AXTextField" or elemRole is "AXTextArea" then
                    set focused of elem to true
                    delay 0.2
                    keystroke "v" using command down
                    delay 0.3
                    keystroke return
                    return "OK"
                  end if
                end try
              end repeat
            end tell
          end if
        end repeat
        return "NOT_FOUND"
      end tell
    end tell
  `;

  try {
    const result = runScript(script);
    return result === 'OK';
  } catch {
    return false;
  }
}

// ==================== 窗口信息 ====================

export interface WindowInfo {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 获取千牛窗口列表
 */
export function listWindows(): WindowInfo[] {
  const script = `
    tell application "System Events"
      tell process "Aliworkbench"
        set out to ""
        repeat with i from 1 to count of windows
          set w to window i
          set n to name of w
          set p to position of w
          set s to size of w
          set out to out & n & "|" & (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s) & ";"
        end repeat
        return out
      end tell
    end tell
  `;

  const result = runScript(script);
  if (!result) return [];

  return result.split(';').filter(Boolean).map(seg => {
    const [name, coords] = seg.split('|');
    const [x, y, w, h] = coords.split(',').map(Number);
    return { name, x, y, w, h };
  });
}

// ==================== 测试 ====================

if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args[0] === 'buyers') {
    console.log('👥 买家列表:');
    const buyers = getBuyerList();
    buyers.forEach((b, i) => {
      console.log(`  ${i + 1}. ${b.name} @(${b.x}, ${b.y})`);
    });
  } else if (args[0] === 'chat') {
    console.log('💬 聊天消息:');
    const msgs = getChatMessagesFromTextArea();
    msgs.forEach((m, i) => {
      console.log(`  ${i + 1}. [${m.sender}] ${m.text}`);
    });
  } else if (args[0] === 'windows') {
    console.log('🪟 窗口列表:');
    const wins = listWindows();
    wins.forEach(w => {
      console.log(`  ${w.name} (${w.x},${w.y}) ${w.w}x${w.h}`);
    });
  } else if (args[0] === 'all') {
    console.log('🪟 窗口列表:');
    listWindows().forEach(w => console.log(`  ${w.name}`));
    console.log('\n👥 买家列表:');
    getBuyerList().forEach((b, i) => console.log(`  ${i + 1}. ${b.name}`));
    console.log('\n💬 聊天消息:');
    getChatMessagesFromTextArea().forEach((m, i) => console.log(`  ${i + 1}. ${m.text}`));
  } else {
    console.log('用法: ts-node ax-api.ts [buyers|chat|windows|all]');
  }
}

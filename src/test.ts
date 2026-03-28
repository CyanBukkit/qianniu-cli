import * as fs from 'fs';

// 直接写文件方式
const script = [
  'tell application "System Events"',
  '  tell process "Aliworkbench"',
  '    tell window "t_1487330154436_074-接待中心"',
  '      set output to ""',
  '      repeat with i from 1 to 20',
  '        try',
  '          set elem to UI element i',
  '          set elemRole to role of elem as string',
  '          set elemName to name of elem as string',
  '          set elemPos to position of elem',
  '          set childCount to count of UI elements of elem',
  '          if elemName is missing value then set elemName to ""',
  '          set output to output & "  " & i & ". [" & elemRole & "] " & elemName & " @" & (item 1 of elemPos) & "," & (item 2 of elemPos) & " children=" & childCount & "\n"',
  '        on error',
  '          exit repeat',
  '        end try',
  '      end repeat',
  '      return output',
  '    end tell',
  '  end tell',
  'end tell'
].join('\n');

fs.writeFileSync('/tmp/qianniu-tree.scpt', script);
console.log('脚本已写入 /tmp/qianniu-tree.scpt');

// 直接执行
const { execSync } = require('child_process');
try {
  const result = execSync('osascript /tmp/qianniu-tree.scpt', { encoding: 'utf8' });
  console.log('第1层结果:\n', result);
} catch (e: any) {
  console.error('错误:', e.message);
}

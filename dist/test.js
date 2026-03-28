"use strict";
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
const fs = __importStar(require("fs"));
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
}
catch (e) {
    console.error('错误:', e.message);
}

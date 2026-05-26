import * as fs from 'fs';
import { screenshot, recognizeText } from '../clipboard';
import { Buyer } from '../types';
import { ALIWORKBENCH, RECEPTION, getChatWindowPosition, getReceptionWindowRect, loadCalibrateConfig, loadRecordedPoint, runScript } from './window';
import { clickAt } from '../recorder';
import { buildChatFingerprint, parseChatTranscript } from '../session';

export function scanBuyerList(): Buyer[] {
  const script = `
    tell application "System Events"
      tell process "${ALIWORKBENCH}"
        set out to ""
        set targetWindow to missing value
        repeat with i from 1 to count of windows
          try
            set w to window i
            set wName to name of w
            if wName contains "接待中心" then
              set targetWindow to w
              exit repeat
            end if
          end try
        end repeat
        
        if targetWindow is missing value then
          return ""
        end if
        
        tell targetWindow
          set g1 to group 1
          set axg to UI element 1 of g1
          repeat with i from 1 to count of UI elements of axg
            try
              set elem to UI element i of axg
              set nm to name of elem
              set pos to position of elem
              set sz to size of elem
              if nm is not missing value then
                set out to out & nm & "|" & (item 1 of pos) & "," & (item 2 of pos) & "|" & (item 1 of sz) & "," & (item 2 of sz) & ";"
              end if
            end try
          end repeat
        end tell
      end tell
    end tell
  `;

  const result = runScript(script);
  const buyers: Buyer[] = [];

  result.split(';').filter(Boolean).forEach(seg => {
    const parts = seg.split('|');
    if (parts.length < 2 || !parts[0]) return;
    const [x, y] = parts[1].split(',').map(Number);
    buyers.push({
      id: parts[0],
      name: parts[0],
      x: x + 10,
      y: y + 26,
    });
  });

  return buyers;
}

export function openChat(_buyer: Buyer): void {
  const newConsultPoint = loadRecordedPoint('新的客户咨询');
  if (!newConsultPoint) return;
  clickAt(newConsultPoint.x, newConsultPoint.y);
  execSync('sleep 1');
}

export async function readMessages(): Promise<string[]> {
  const chatPath = '/tmp/qianniu-chat.png';

  let chatX: number;
  let chatY: number;
  let chatW = 900;
  let chatH = 500;

  const calibrate = loadCalibrateConfig();
  if (calibrate) {
    chatX = calibrate.x;
    chatY = calibrate.y;
    chatW = calibrate.w;
    chatH = calibrate.h;
    console.log(`📍 使用标定坐标: (${chatX}, ${chatY}) ${chatW}x${chatH}`);
  } else {
    const windowPos = getChatWindowPosition();
    if (windowPos) {
      chatX = windowPos.x;
      chatY = windowPos.y;
      chatW = windowPos.w;
      chatH = windowPos.h;
    } else {
      const receptionRect = getReceptionWindowRect();
      if (receptionRect) {
        chatX = receptionRect.x + 260;
        chatY = receptionRect.y + 50;
        chatW = Math.max(receptionRect.w - 320, 600);
        chatH = Math.max(receptionRect.h - 160, 300);
        console.log(`📍 使用接待中心窗口推导坐标: (${chatX}, ${chatY}) ${chatW}x${chatH}`);
      } else {
        chatX = RECEPTION.x + 260;
        chatY = RECEPTION.y + 50;
        console.log(`📍 使用默认坐标: (${chatX}, ${chatY})`);
      }
    }
  }

  screenshot(chatX, chatY, chatW, chatH, chatPath);
  const text = await recognizeText(chatPath);

  try { fs.unlinkSync(chatPath); } catch {}

  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 1 && !l.match(/^(ERROR|OCR)/));
}

export async function readChatTranscript(): Promise<string> {
  const messages = await readMessages();
  return messages.join('\n');
}

export async function readParsedChat() {
  const transcript = await readChatTranscript();
  const parsedMessages = parseChatTranscript(transcript);
  const fingerprint = buildChatFingerprint(parsedMessages);
  return {
    transcript,
    parsedMessages,
    fingerprint,
  };
}

function execSync(command: string): void {
  require('child_process').execSync(command);
}

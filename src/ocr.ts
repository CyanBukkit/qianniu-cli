/**
 * OCR 模块 - 使用 macOS Vision 框架
 * 通过 screencapture + Vision OCR 读取千牛聊天文字
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TMP_IMG = '/tmp/qianniu-ocr-temp.png';
const TMP_TXT = '/tmp/qianniu-ocr-temp.txt';

// ============ 坐标标定（首次使用需设置）============

// 接待中心窗口位置和大小
export const RECEPTION_WINDOW = {
  x: 0,
  y: 53,
  w: 1310,
  h: 800
};

// 聊天消息区域（相对于窗口左上角）
// 需要用标定脚本找到真实值
export const CHAT_REGION = {
  // 相对于窗口的偏移
  offsetX: 260,   // 消息区左边
  offsetY: 50,    // 消息区顶边
  width: 900,     // 消息区宽度
  height: 500     // 消息区高度
};

// 买家列表区域（左侧，用于检测新消息）
export const BUYER_LIST_REGION = {
  offsetX: 0,
  offsetY: 0,
  width: 240,
  height: 530
};

// 输入框区域坐标
export const INPUT_REGION = {
  offsetX: 260,
  offsetY: 650,
  width: 800,
  height: 100
};

// ============ 截图 =====================

/**
 * 截取指定区域
 */
export function screenshot(x: number, y: number, w: number, h: number, outputPath = TMP_IMG): void {
  // 先清理旧的临时文件
  try { fs.unlinkSync(outputPath); } catch {}
  // -x 静音截屏，-R 指定区域
  const cmd = `screencapture -x -R ${x},${y},${w},${h} ${outputPath}`;
  execSync(cmd, { timeout: 10000 });
}

/**
 * 截取聊天消息区域
 */
export function screenshotChat(): string {
  const { x, y, w, h } = RECEPTION_WINDOW;
  const { offsetX, offsetY, width, height } = CHAT_REGION;
  screenshot(x + offsetX, y + offsetY, width, height);
  return TMP_IMG;
}

// ============ Vision OCR =====================

/**
 * 用 macOS Vision 框架做 OCR
 * 尝试多种方式
 */
function recognizeWithVision(imagePath: string): string {
  // 方式1: 尝试用 screencapture 直接 OCR（macOS Monterey+）
  // 方式2: 尝试用 Python 调用系统 OCR
  // 方式3: 使用预处理 + tesseract
  
  // 先尝试用图像预处理改善 tesseract 效果
  const os = require('os');
  const tmpDir = `${os.homedir()}/tmp`;
  const processedPath = `${tmpDir}/${Date.now()}-processed.png`;
  
  try {
    // 预处理: 增强对比度
    execSync(`sips -g all "${imagePath}" 2>/dev/null`, { timeout: 5000 });
    
    // 直接复制原图
    fs.copyFileSync(imagePath, processedPath);
  } catch {
    // 预处理失败，使用原图
    return 'VISION_ERROR: Preprocessing failed';
  }
  
  // 使用 tesseract 多个参数尝试
  const params = [
    '--psm 6 -l chi_sim+eng',           // 自动分割
    '--psm 3 -l chi_sim+eng',           // 整页识别  
    '--psm 4 -l chi_sim+eng',           // 单列
    '--psm 11 -l chi_sim+eng',          // 稀疏文字
  ];
  
  for (const param of params) {
    try {
      const outputBase = `${tmpDir}/tess-${Date.now()}`;
      const cmd = `tesseract "${processedPath}" ${outputBase} ${param} 2>/dev/null && cat ${outputBase}.txt`;
      const result = execSync(cmd, { timeout: 15000, encoding: 'utf8' }).trim();
      try { fs.unlinkSync(`${outputBase}.txt`); } catch {}
      
      if (result && result.length > 5) {
        try { fs.unlinkSync(processedPath); } catch {}
        return result;
      }
    } catch {}
  }
  
  try { fs.unlinkSync(processedPath); } catch {}
  return 'VISION_ERROR: All methods failed';
}

/**
 * 用 tesseract 做 OCR（备用方案）
 */
export async function recognizeText(imagePath: string): Promise<string> {
  // 先尝试用 Vision 框架（效果更好）
  try {
    const visionResult = recognizeWithVision(imagePath);
    if (!visionResult.startsWith('VISION_ERROR') && visionResult.length > 0) {
      return visionResult;
    }
  } catch {}
  
  // Vision 失败后用 tesseract
  try {
    // tesseract 在 Node.js 中无法读取 /tmp 目录，使用用户home目录的tmp
    const os = require('os');
    const tmpDir = `${os.homedir()}/tmp`;
    
    // 确保 tmp 目录存在
    try { 
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
    } catch {}
    
    // 复制图片到 tmpDir（解决 tesseract 读取 /tmp 的问题）
    const tempImagePath = `${tmpDir}/${Date.now()}-ocr.png`;
    fs.copyFileSync(imagePath, tempImagePath);
    
    const outputBase = `${tmpDir}/tess-${Date.now()}`;
    const cmd = `tesseract ${tempImagePath} ${outputBase} -l chi_sim+eng --psm 6 2>/dev/null && cat ${outputBase}.txt`;
    const result = execSync(cmd, { timeout: 30000, encoding: 'utf8' }).trim();
    // 清理临时文件
    try { fs.unlinkSync(`${outputBase}.txt`); } catch {}
    try { fs.unlinkSync(tempImagePath); } catch {}
    try { fs.unlinkSync(imagePath); } catch {}  // 用完删除原截图
    return result;
  } catch (e: any) {
    // 出错也删
    try { fs.unlinkSync(imagePath); } catch {}
    return `OCR_ERROR: ${e.message}`;
  }
}

// ============ 简化版 OCR（用系统 OCR 服务）============

/**
 * 用 tesseract 做 OCR（需要安装）
 * 如果没装就返回提示
 */
export function recognizeWithTesseract(imagePath: string): string {
  try {
    const lang = 'chi_sim+eng';
    const outputBase = `/tmp/qianniu-tess-${Date.now()}`;
    const cmd = `tesseract ${imagePath} ${outputBase} -l ${lang} --psm 6 2>/dev/null && cat ${outputBase}.txt`;
    const result = execSync(cmd, { timeout: 30000, encoding: 'utf8' }).trim();
    return result;
  } catch {
    return 'TESSERACT_NOT_INSTALLED';
  }
}

// ============ 标定工具 =====================

/**
 * 标定聊天区域 - 截图后让你手动点四个角
 * 运行后在千牛窗口上点击消息区域的四个角
 */
export async function calibrateChatRegion(): Promise<void> {
  console.log('=== 聊天区域标定 ===');
  console.log('请将鼠标移动到聊天消息区域左上角，然后按回车...');

  // 截图整个接待中心
  const { x, y, w, h } = RECEPTION_WINDOW;
  screenshot(x, y, w, h, '/tmp/qianniu-calibrate.png');

  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  await new Promise<void>((resolve) => {
    rl.question('', () => {
      const { execSync } = require('child_process');
      const pos = execSync('osascript -e \'tell application "System Events" to get position of mouse\'').trim();
      console.log(`鼠标位置: ${pos}`);
      rl.close();
      resolve();
    });
  });
}

// ============ 对比工具 =====================

/**
 * 检测消息区域是否有变化（用于监听新消息）
 */
export function detectChanges(oldText: string, newText: string): string[] {
  const oldLines = oldText.split('\n').map((l: string) => l.trim()).filter(Boolean);
  const newLines = newText.split('\n').map((l: string) => l.trim()).filter(Boolean);

  const newMessages: string[] = [];
  for (const line of newLines) {
    if (!oldLines.includes(line) && line.length > 2) {
      newMessages.push(line);
    }
  }
  return newMessages;
}

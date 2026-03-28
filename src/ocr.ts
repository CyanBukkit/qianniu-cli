/**
 * OCR 模块 - 使用 Sharp 图像预处理 + Tesseract 命令行
 * 参考教程：https://juejin.cn/post/7506714637040222227
 * 优化：灰度化 + 对比度增强
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';

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

// ============ 图像预处理 =====================

/**
 * 预处理图像以改善OCR效果（参考教程优化）
 * 1. 放大2倍 - 提高文字清晰度
 * 2. 灰度化 - 减少颜色干扰
 * 3. 对比度增强 - 使文字更清晰
 * 4. 二值化 - 滤除噪声，使背景更干净
 */
async function preprocessImage(inputPath: string): Promise<Buffer> {
  try {
    // 使用 sharp 进行预处理
    const buffer = await sharp(inputPath)
      .resize({ kernel: sharp.kernel.lanczos3 })  // 使用高质量缩放
      .grayscale()                                // 灰度化
      .normalise()                                // 对比度增强
      // 不使用二值化，保持平滑以便tesseract更好地识别
      .toBuffer();
    
    return buffer;
  } catch (e) {
    console.error('图像预处理失败:', e);
    // 预处理失败，返回原图
    return fs.readFileSync(inputPath);
  }
}

// ============ OCR 识别 =====================

/**
 * 改进的 OCR 识别 - 使用Sharp预处理 + Tesseract.js
 * 参考教程优化：灰度化 + 对比度增强
 */
export async function recognizeText(imagePath: string): Promise<string> {
  const os = require('os');
  const tmpDir = `${os.homedir()}/tmp`;
  const tessdataDir = `${os.homedir()}/tessdata`;
  
  // 确保目录存在
  try { 
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    if (!fs.existsSync(tessdataDir)) {
      fs.mkdirSync(tessdataDir, { recursive: true });
    }
  } catch {}
  
  try {
    // 1. 图像预处理（关键优化！）
    const processedBuffer = await preprocessImage(imagePath);
    
    // 复制到home目录的tmp
    const tempImagePath = `${tmpDir}/${Date.now()}-ocr.png`;
    fs.writeFileSync(tempImagePath, processedBuffer);
    
    // 2. 使用 tesseract.js 识别（指定本地语言包路径）
    let text = '';
    try {
      // 检查本地语言包是否存在
      const langPath = tessdataDir;
      const hasLocalLang = fs.existsSync(`${langPath}/chi_sim.traineddata`) && 
                           fs.existsSync(`${langPath}/eng.traineddata`);
      
      if (hasLocalLang) {
        console.log('📦 使用本地语言包...');
        // 使用本地语言包 - tesseract.js v7 API
        const worker = await Tesseract.createWorker('chi_sim+eng', 1, {
          langPath: langPath,
          logger: m => {
            if (m.status === 'recognizing text') {
              process.stdout.write(`\r OCR进度: ${Math.round(m.progress * 100)}%`);
            }
          }
        });
        
        const { data: { text: result } } = await worker.recognize(tempImagePath);
        text = result;
        
        await worker.terminate();
        console.log(''); // 换行
      } else {
        // 没有本地语言包，尝试使用命令行 tesseract
        console.log('⚠️ 本地语言包未找到，使用命令行OCR...');
        throw new Error('No local lang data');
      }
    } catch (e) {
      console.log('Tesseract.js OCR失败:', e);
      // 备选：尝试使用命令行 tesseract（仅英文）
      try {
        const outputBase = `${tmpDir}/tess-${Date.now()}`;
        const cmd = `tesseract "${tempImagePath}" ${outputBase} -l eng --psm 6 2>&1 && cat ${outputBase}.txt`;
        text = execSync(cmd, { timeout: 30000, encoding: 'utf8' }).trim();
        try { fs.unlinkSync(`${outputBase}.txt`); } catch {}
      } catch (e2) {
        console.log('命令行OCR也失败:', e2);
      }
    }
    
    // 清理临时文件
    try { fs.unlinkSync(tempImagePath); } catch {}
    // 清理原截图
    try { fs.unlinkSync(imagePath); } catch {}
    
    // 提取识别的文本
    if (!text) {
      return 'OCR_ERROR: No text detected';
    }
    
    // 过滤结果
    const lines = text.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 1);
    
    if (lines.length > 0) {
      return lines.join('\n');
    }
    
    return 'OCR_ERROR: No text detected';
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

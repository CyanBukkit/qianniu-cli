/**
 * 模板匹配模块
 * 用于捕获和匹配右上角消息提示框
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TEMPLATES_DIR = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/templates';

// 确保模板目录存在
if (!fs.existsSync(TEMPLATES_DIR)) {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

// ============ 选区截图 ============

/**
 * 交互式选区截图
 * 用户框选区域后保存截图
 */
export function captureRegion(outputName: string): string | null {
  const outputPath = `${TEMPLATES_DIR}/${outputName}.png`;
  
  console.log('\n框选区域截图...');
  console.log('👉 请用鼠标框选要捕获的区域');
  console.log('   按 ESC 取消\n');

  try {
    // -i 交互模式，-x 静音
    execSync(`screencapture -i -x "${outputPath}"`, { timeout: 60000 });
    
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      if (stats.size > 0) {
        console.log(`✅ 已保存: ${outputPath}`);
        console.log(`   大小: ${stats.size} bytes`);
        return outputPath;
      }
    }
    
    console.log('❌ 截图取消或失败');
    return null;
  } catch (e: any) {
    console.log('❌ 截图取消');
    return null;
  }
}

/**
 * 截取指定区域（自动选区，用于录制坐标时保存模板）
 */
export function captureRect(x: number, y: number, w: number, h: number, outputName: string): string {
  const outputPath = `${TEMPLATES_DIR}/${outputName}.png`;
  
  // 先删旧的
  try { fs.unlinkSync(outputPath); } catch {}
  
  execSync(`screencapture -x -R ${x},${y},${w},${h} "${outputPath}"`, { timeout: 10000 });
  
  console.log(`✅ 已保存: ${outputPath}`);
  return outputPath;
}

// ============ 模板列表 ============

interface TemplateInfo {
  name: string;
  path: string;
  size: { w: number; h: number };
  fileSize: number;
  createdAt: Date;
}

/**
 * 列出所有模板
 */
export function listTemplates(): TemplateInfo[] {
  const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.png'));
  
  return files.map(f => {
    const fullPath = `${TEMPLATES_DIR}/${f}`;
    const stats = fs.statSync(fullPath);
    
    // 用 Python 读图片尺寸
    let w = 0, h = 0;
    try {
      const sizeCmd = `python3 -c "from PIL import Image; img=Image.open('${fullPath}'); print(f'{img.size[0]},{img.size[1]}')"`;
      const sizeResult = execSync(sizeCmd, { encoding: 'utf8' }).trim();
      [w, h] = sizeResult.split(',').map(Number);
    } catch {}
    
    return {
      name: f.replace('.png', ''),
      path: fullPath,
      size: { w, h },
      fileSize: stats.size,
      createdAt: stats.mtime
    };
  });
}

/**
 * 显示模板列表
 */
export function showTemplates(): void {
  const templates = listTemplates();
  
  if (templates.length === 0) {
    console.log('暂无模板');
    console.log('\n使用 capture <名称> 来捕获模板');
    return;
  }
  
  console.log(`\n已保存的模板 (${templates.length} 个):\n`);
  templates.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.name}`);
    console.log(`     尺寸: ${t.size.w}x${t.size.h}  文件: ${(t.fileSize / 1024).toFixed(1)}KB`);
    console.log(`     路径: ${t.path}`);
  });
}

/**
 * 删除模板
 */
export function deleteTemplate(name: string): void {
  const filePath = `${TEMPLATES_DIR}/${name}.png`;
  try {
    fs.unlinkSync(filePath);
    console.log(`✅ 已删除: ${name}`);
  } catch {
    console.log(`❌ 找不到: ${name}`);
  }
}

/**
 * 打开模板查看
 */
export function openTemplate(name: string): void {
  const filePath = `${TEMPLATES_DIR}/${name}.png`;
  if (fs.existsSync(filePath)) {
    execSync(`open "${filePath}"`);
    console.log(`✅ 已打开: ${name}`);
  } else {
    console.log(`❌ 找不到: ${name}`);
  }
}

// ============ 模板匹配 ============

/**
 * 在屏幕上查找模板
 * 返回匹配位置（中心点坐标）
 */
export function findTemplate(templateName: string, threshold = 0.8): { x: number; y: number; confidence: number } | null {
  const templatePath = `${TEMPLATES_DIR}/${templateName}.png`;
  
  if (!fs.existsSync(templatePath)) {
    console.log(`❌ 模板不存在: ${templateName}`);
    return null;
  }
  
  // 用 Python + OpenCV 做模板匹配
  const script = `
import cv2
import numpy as np
from PIL import ImageGrab

# 截取全屏
screenshot = ImageGrab.grab()
screen_img = cv2.cvtColor(np.array(screenshot), cv2.COLOR_RGB2BGR)

# 读取模板
template = cv2.imread('${templatePath}')
if template is None:
    print('ERROR: cannot load template')
    exit(1)

# 模板匹配
result = cv2.matchTemplate(screen_img, template, cv2.TM_CCOEFF_NORMED)
min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)

if max_val >= ${threshold}:
    h, w = template.shape[:2]
    center_x = max_loc[0] + w // 2
    center_y = max_loc[1] + h // 2
    print(f'{center_x},{center_y},{max_val:.3f}')
else:
    print('NOT_FOUND')
`;

  try {
    const result = execSync(`python3 -c '${script}'`, { timeout: 10000, encoding: 'utf8' }).trim();
    
    if (result === 'NOT_FOUND') {
      return null;
    }
    
    const [x, y, confidence] = result.split(',').map(Number);
    return { x, y, confidence };
  } catch (e: any) {
    // 可能没装 OpenCV
    if (e.message.includes('cv2')) {
      console.log('⚠️  需要 OpenCV，安装: pip3 install opencv-python');
    }
    return null;
  }
}

/**
 * 检测右上角是否有新消息提示
 */
export function hasNewMessage(): boolean {
  const result = findTemplate('消息提示', 0.85);
  return result !== null;
}

// ============ 导出 ============

export {
  TEMPLATES_DIR
};

/**
 * 方法二：Electron desktopCapturer
 * 
 * 原理：Electron 的 desktopCapturer API 可以枚举屏幕上所有窗口/标签页，
 *       然后获取窗口的缩略图（thumbnail）和详情
 * 
 * 注意：需要 Electron 环境。这里用 npx electron 运行一个临时脚本，
 *       捕获结果通过 stdout JSON 返回给主进程。
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
const TMP_SCRIPT = '/tmp/qianniu-electron-dc.js';

export interface BuyerInfo {
  name: string;
  thumbnailPath: string;
  hasNewMessage: boolean;
}

export interface ChatMessage {
  sender: 'buyer' | 'seller';
  text: string;
}

export interface DetectionResult {
  buyers: BuyerInfo[];
  newBuyer: BuyerInfo | null;
  windowThumbnail: string; // 窗口缩略图路径
  method: 'electron-dc';
  timestamp: number;
  _error?: string;
}

// ============ Electron 捕获脚本 ============

const ELECTRON_CAPTURE_SCRIPT = `
const { desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');

async function capture() {
  const RESULTS = [];
  
  // 获取屏幕信息
  const displays = screen.getAllDisplays();
  
  // 枚举所有窗口
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 300, height: 200 },
    fetchWindowless: false
  });
  
  // 找千牛窗口
  for (const source of sources) {
    const name = source.name;
    const id = source.id;
    
    // 匹配千牛/旺旺相关窗口
    if (name.includes('接待中心') || 
        name.includes('Aliworkbench') || 
        name.includes('千牛') ||
        name.includes('旺旺')) {
      
      RESULTS.push({
        name: name,
        id: id,
        thumbnail: source.thumbnail.toDataURL(),
        display_id: source.display_id
      });
    }
  }
  
  // 如果没找到，列出所有窗口供调试
  if (RESULTS.length === 0) {
    for (const source of sources) {
      if (!source.name.includes('Electron') && !source.name.includes('OpenClaw')) {
        RESULTS.push({
          name: source.name,
          id: source.id,
          thumbnail: source.thumbnail.toDataURL().slice(0, 100) + '...',
          display_id: source.display_id
        });
      }
    }
  }
  
  console.log('QIANNIU_DC_RESULT:' + JSON.stringify(RESULTS));
}

capture().catch(e => {
  console.error('ERROR:' + e.message);
  process.exit(1);
});
`;

// ============ 检查 Electron 是否可用 ============

function isElectronAvailable(): boolean {
  try {
    const result = execSync('which electron 2>/dev/null || npx electron --version 2>/dev/null', { encoding: 'utf8', timeout: 10000 });
    return result.includes('v') || result.includes('Electron');
  } catch {
    return false;
  }
}

// ============ 用 npx 运行 Electron 捕获 ============

export async function detectByElectron(): Promise<DetectionResult> {
  const timestamp = Date.now();
  
  // 写临时脚本
  fs.writeFileSync(TMP_SCRIPT, ELECTRON_CAPTURE_SCRIPT, 'utf8');
  
  return new Promise((resolve) => {
    try {
      // 尝试 electron 或 npx electron
      let electronCmd = 'electron';
      try {
        execSync('which electron', { timeout: 3000 });
      } catch {
        electronCmd = 'npx electron';
      }
      
      const proc = spawn(electronCmd, [TMP_SCRIPT, '--no-sandbox'], {
        timeout: 15000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });
      
      proc.on('close', (code) => {
        try { fs.unlinkSync(TMP_SCRIPT); } catch {}
        
        if (code !== 0 && !stdout.includes('QIANNIU_DC_RESULT')) {
          resolve({
            buyers: [],
            newBuyer: null,
            windowThumbnail: '',
            method: 'electron-dc',
            timestamp,
            _error: stderr || `exit code ${code}`
          });
          return;
        }
        
        // 解析结果
        const match = stdout.match(/QIANNIU_DC_RESULT:(.+)/s);
        if (!match) {
          resolve({
            buyers: [],
            newBuyer: null,
            windowThumbnail: '',
            method: 'electron-dc',
            timestamp
          });
          return;
        }
        
        try {
          const sources = JSON.parse(match[1]);
          const buyers: BuyerInfo[] = sources.map((s: any) => ({
            name: s.name,
            thumbnailPath: '', // thumbnail 是 base64，无法直接存文件
            hasNewMessage: s.name.includes('接待中心'),
          }));
          
          resolve({
            buyers,
            newBuyer: buyers.find(b => b.hasNewMessage) || null,
            windowThumbnail: sources[0]?.thumbnail || '',
            method: 'electron-dc',
            timestamp
          });
        } catch {
          resolve({
            buyers: [],
            newBuyer: null,
            windowThumbnail: '',
            method: 'electron-dc',
            timestamp
          });
        }
      });
      
      proc.on('error', () => {
        try { fs.unlinkSync(TMP_SCRIPT); } catch {}
        resolve({
          buyers: [],
          newBuyer: null,
          windowThumbnail: '',
          method: 'electron-dc',
          timestamp,
          _error: 'spawn error'
        });
      });
      
      // 超时保护
      setTimeout(() => {
        try { proc.kill(); } catch {}
        try { fs.unlinkSync(TMP_SCRIPT); } catch {}
        resolve({
          buyers: [],
          newBuyer: null,
          windowThumbnail: '',
          method: 'electron-dc',
          timestamp,
          _error: 'timeout'
        });
      }, 20000);
      
    } catch (e: any) {
      try { fs.unlinkSync(TMP_SCRIPT); } catch {}
      resolve({
        buyers: [],
        newBuyer: null,
        windowThumbnail: '',
        method: 'electron-dc',
        timestamp,
        _error: e.message
      });
    }
  });
}

// ============ CLI 测试 ============

if (require.main === module) {
  console.log('=== 方法二：Electron desktopCapturer ===\n');
  
  if (!isElectronAvailable()) {
    console.log('⚠️  Electron 未安装，跳过此方法');
    console.log('   安装: npm install -g electron');
    console.log('   或:   brew install --cask electron');
    process.exit(0);
  }
  
  console.log('⏳ 正在通过 Electron desktopCapturer 捕获窗口...\n');
  
  detectByElectron().then(result => {
    console.log(`检测时间: ${new Date(result.timestamp).toLocaleString()}`);
    console.log(`检测到窗口: ${result.buyers.length} 个`);
    
    if ((result as any)._error) {
      console.log(`错误: ${(result as any)._error}`);
    }
    
    result.buyers.forEach((b, i) => {
      console.log(`${i + 1}. ${b.hasNewMessage ? '🔴' : '⚪'} ${b.name}`);
    });
    
    if (result.windowThumbnail) {
      console.log('\n📸 窗口缩略图已捕获（base64）');
    }
  });
}

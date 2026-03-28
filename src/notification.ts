/**
 * macOS 系统通知监听模块
 * 监听千牛新消息通知
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// 通知数据库路径
const NOTIF_DB = path.join(
  process.env.HOME || '',
  'Library/Application Support/NotificationCenter',
  '*.db'
);

interface Notification {
  appId?: string;
  title?: string;
  body?: string;
  timestamp: number;
}

// 找到通知数据库文件
function findNotifDb(): string | null {
  try {
    const glob = execSync(`echo ${NOTIF_DB}`, { encoding: 'utf8' }).trim();
    const files = glob.split('\n').filter(f => f && fs.existsSync(f));
    // 返回最新的数据库文件
    return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  } catch {
    return null;
  }
}

// 从数据库读取最近的千牛通知
function readRecentNotifications(limit = 10): Notification[] {
  const dbPath = findNotifDb();
  if (!dbPath) {
    return [];
  }

  try {
    // 使用 sqlite3 查询最近的通知
    const result = execSync(
      `sqlite3 "${dbPath}" "SELECT app_id, title, body, delivered_date FROM notification WHERE app_id LIKE '%qianniu%' OR app_id LIKE '%Aliworkbench%' OR title LIKE '%单聊%' OR body LIKE '%单聊%' ORDER BY delivered_date DESC LIMIT ${limit};" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    );

    if (!result.trim()) return [];

    return result.trim().split('\n').map(line => {
      const parts = line.split('|');
      return {
        appId: parts[0] || '',
        title: parts[1] || '',
        body: parts[2] || '',
        timestamp: parseInt(parts[3] || '0', 10) * 1000 // 转换为毫秒
      };
    });
  } catch {
    return [];
  }
}

// 监听新通知（轮询方式）
let lastCheckTime = Date.now();

export function checkNewMessages(): { hasNew: boolean; messages: Notification[] } {
  const notifications = readRecentNotifications(20);
  const newOnes = notifications.filter(n => n.timestamp > lastCheckTime);
  
  // 更新检查时间
  lastCheckTime = Date.now();

  // 过滤千牛相关通知（单聊消息）
  const qianniuMessages = newOnes.filter(n => {
    const text = `${n.title || ''} ${n.body || ''}`.toLowerCase();
    return text.includes('单聊') || text.includes('qianniu') || text.includes('aliwork');
  });

  return {
    hasNew: qianniuMessages.length > 0,
    messages: qianniuMessages
  };
}

// 测试用：列出最近的千牛通知
export function listQianniuNotifications(limit = 10): void {
  const notifications = readRecentNotifications(limit);
  console.log('\n📱 最近千牛通知:');
  console.log('─'.repeat(50));
  
  if (notifications.length === 0) {
    console.log('暂无通知');
    return;
  }

  notifications.forEach((n, i) => {
    const time = new Date(n.timestamp).toLocaleString('zh-CN');
    console.log(`${i + 1}. [${time}]`);
    console.log(`   App: ${n.appId}`);
    console.log(`   ${n.title || '(无标题)'} - ${n.body || '(无内容)'}`);
    console.log();
  });
}

// 持续监听模式
export function startNotificationMonitor(
  onNewMessage: (notif: Notification) => void,
  intervalMs = 3000
): NodeJS.Timeout {
  console.log(`🔔 开始监听千牛通知，每 ${intervalMs / 1000}s 检查一次...`);
  console.log('按 Ctrl+C 停止\n');

  return setInterval(() => {
    const { hasNew, messages } = checkNewMessages();
    if (hasNew) {
      messages.forEach(onNewMessage);
    }
  }, intervalMs);
}

// 命令行测试
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args[0] === 'list') {
    listQianniuNotifications(20);
  } else if (args[0] === 'watch') {
    startNotificationMonitor((n) => {
      console.log('\n🆕 新消息!');
      console.log(`   ${n.title} - ${n.body}`);
    });
  } else {
    console.log('用法:');
    console.log('  ts-node notification.ts list  - 列出最近的千牛通知');
    console.log('  ts-node notification.ts watch - 持续监听新通知');
  }
}

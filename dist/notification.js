"use strict";
/**
 * macOS 系统通知监听模块
 * 监听千牛新消息通知
 */
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
exports.checkNewMessages = checkNewMessages;
exports.listQianniuNotifications = listQianniuNotifications;
exports.startNotificationMonitor = startNotificationMonitor;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
// 通知数据库路径
const NOTIF_DB = path.join(process.env.HOME || '', 'Library/Application Support/NotificationCenter', '*.db');
// 找到通知数据库文件
function findNotifDb() {
    try {
        const glob = (0, child_process_1.execSync)(`echo ${NOTIF_DB}`, { encoding: 'utf8' }).trim();
        const files = glob.split('\n').filter(f => f && fs.existsSync(f));
        // 返回最新的数据库文件
        return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
    }
    catch {
        return null;
    }
}
// 从数据库读取最近的千牛通知
function readRecentNotifications(limit = 10) {
    const dbPath = findNotifDb();
    if (!dbPath) {
        return [];
    }
    try {
        // 使用 sqlite3 查询最近的通知
        const result = (0, child_process_1.execSync)(`sqlite3 "${dbPath}" "SELECT app_id, title, body, delivered_date FROM notification WHERE app_id LIKE '%qianniu%' OR app_id LIKE '%Aliworkbench%' OR title LIKE '%单聊%' OR body LIKE '%单聊%' ORDER BY delivered_date DESC LIMIT ${limit};" 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
        if (!result.trim())
            return [];
        return result.trim().split('\n').map(line => {
            const parts = line.split('|');
            return {
                appId: parts[0] || '',
                title: parts[1] || '',
                body: parts[2] || '',
                timestamp: parseInt(parts[3] || '0', 10) * 1000 // 转换为毫秒
            };
        });
    }
    catch {
        return [];
    }
}
// 监听新通知（轮询方式）
let lastCheckTime = Date.now();
function checkNewMessages() {
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
function listQianniuNotifications(limit = 10) {
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
function startNotificationMonitor(onNewMessage, intervalMs = 3000) {
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
    }
    else if (args[0] === 'watch') {
        startNotificationMonitor((n) => {
            console.log('\n🆕 新消息!');
            console.log(`   ${n.title} - ${n.body}`);
        });
    }
    else {
        console.log('用法:');
        console.log('  ts-node notification.ts list  - 列出最近的千牛通知');
        console.log('  ts-node notification.ts watch - 持续监听新通知');
    }
}

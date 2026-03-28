"use strict";
/**
 * 规则引擎核心
 * 关键词匹配 + 自动回复
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
exports.CONFIG_PATH = void 0;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.getConfig = getConfig;
exports.updateConfig = updateConfig;
exports.generateReply = generateReply;
exports.forceReply = forceReply;
exports.addRule = addRule;
exports.deleteRule = deleteRule;
exports.toggleRule = toggleRule;
exports.listRules = listRules;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// 默认配置
const DEFAULT_CONFIG = {
    rules: [],
    defaultReply: '您好，感谢您的咨询！客服稍后会为您服务~',
    enableLog: true,
    cooldownSeconds: 30
};
const CONFIG_PATH = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/reply-config.json';
exports.CONFIG_PATH = CONFIG_PATH;
// ============ 配置管理 ============
let config = { ...DEFAULT_CONFIG };
/**
 * 加载配置
 */
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            const loaded = JSON.parse(data);
            config = { ...DEFAULT_CONFIG, ...loaded };
            if (config.enableLog) {
                console.log(`📋 已加载 ${config.rules.length} 条规则`);
            }
        }
        else {
            // 使用默认规则
            config.rules = (0, rules_1.getDefaultRules)();
            saveConfig();
        }
    }
    catch (e) {
        console.error('加载配置失败:', e);
        config = { ...DEFAULT_CONFIG, rules: (0, rules_1.getDefaultRules)() };
    }
    return config;
}
/**
 * 保存配置
 */
function saveConfig() {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}
/**
 * 获取当前配置
 */
function getConfig() {
    return config;
}
/**
 * 更新配置
 */
function updateConfig(newConfig) {
    config = { ...config, ...newConfig };
    saveConfig();
}
// 记录每个买家的最后回复时间
const buyerLastReply = {};
/**
 * 清理过期的冷却记录
 */
function cleanupCooldown() {
    const now = Date.now();
    const threshold = config.cooldownSeconds * 1000 * 2; // 2倍冷却时间后清理
    for (const buyerId in buyerLastReply) {
        if (now - buyerLastReply[buyerId] > threshold) {
            delete buyerLastReply[buyerId];
        }
    }
}
/**
 * 检查买家是否在冷却期
 */
function isInCooldown(buyerId) {
    const lastReply = buyerLastReply[buyerId];
    if (!lastReply)
        return false;
    return Date.now() - lastReply < config.cooldownSeconds * 1000;
}
/**
 * 标记买家已回复
 */
function markReplied(buyerId) {
    buyerLastReply[buyerId] = Date.now();
}
/**
 * 文本相似度计算（简单版）
 */
function calculateSimilarity(text1, text2) {
    const s1 = text1.toLowerCase();
    const s2 = text2.toLowerCase();
    if (s2.includes(s1))
        return 1;
    // 简单的包含匹配
    for (const char of s1) {
        if (s2.includes(char)) {
            return 0.3;
        }
    }
    return 0;
}
/**
 * 匹配规则
 */
function matchRule(message) {
    const msgLower = message.toLowerCase();
    let bestMatch = null;
    // 按优先级排序
    const sortedRules = [...config.rules]
        .filter(r => r.enabled)
        .sort((a, b) => b.priority - a.priority);
    for (const rule of sortedRules) {
        // 检查排除关键词
        if (rule.excludeKeywords) {
            const hasExcluded = rule.excludeKeywords.some(k => msgLower.includes(k.toLowerCase()));
            if (hasExcluded)
                continue;
        }
        let isMatch = false;
        let matchedKeyword = '';
        if (rule.requireAllKeywords) {
            // 需要所有关键词都匹配
            const allMatch = rule.keywords.every(k => msgLower.includes(k.toLowerCase()));
            if (allMatch) {
                isMatch = true;
                matchedKeyword = rule.keywords[0];
            }
        }
        else {
            // 任意关键词匹配即可
            for (const keyword of rule.keywords) {
                if (msgLower.includes(keyword.toLowerCase())) {
                    isMatch = true;
                    matchedKeyword = keyword;
                    break;
                }
            }
        }
        if (isMatch) {
            // 计算匹配分数 = 关键词长度 / 消息长度（越精确分数越高）
            const score = keyword => keyword.length / message.length;
            if (!bestMatch || score(matchedKeyword) > bestMatch.score) {
                bestMatch = {
                    rule,
                    matchedKeyword,
                    score: score(matchedKeyword)
                };
            }
        }
    }
    return bestMatch;
}
// ============ 对外接口 ============
/**
 * 处理买家消息，生成回复
 * @param buyerId 买家ID
 * @param message 买家消息
 * @returns 回复内容，如果不应回复则返回 null
 */
function generateReply(buyerId, message) {
    // 清理过期记录
    cleanupCooldown();
    // 检查冷却
    if (isInCooldown(buyerId)) {
        if (config.enableLog) {
            console.log(`⏳ ${buyerId} 在冷却期内，跳过`);
        }
        return null;
    }
    if (!message || message.trim().length < 2) {
        return null;
    }
    // 匹配规则
    const match = matchRule(message);
    let reply;
    if (match) {
        // 检查是否是随机回复
        if (match.rule.reply === 'RANDOM' && match.rule.randomReplies && match.rule.randomReplies.length > 0) {
            // 随机选择一条
            const idx = Math.floor(Math.random() * match.rule.randomReplies.length);
            reply = match.rule.randomReplies[idx];
            if (config.enableLog) {
                console.log(`🎲 随机回复 "${match.rule.name}" -> "${reply.substring(0, 20)}..."`);
            }
        }
        else {
            reply = match.rule.reply;
            if (config.enableLog) {
                console.log(`✅ 匹配规则 "${match.rule.name}" (${match.matchedKeyword})`);
            }
        }
    }
    else {
        reply = config.defaultReply;
        if (config.enableLog) {
            console.log(`📝 使用默认回复`);
        }
    }
    // 标记已回复
    markReplied(buyerId);
    return reply;
}
/**
 * 手动触发回复（跳过冷却检查）
 */
function forceReply(message) {
    const match = matchRule(message);
    return match ? match.rule.reply : config.defaultReply;
}
/**
 * 添加规则
 */
function addRule(rule) {
    config.rules.push(rule);
    saveConfig();
}
/**
 * 删除规则
 */
function deleteRule(ruleId) {
    const index = config.rules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
        config.rules.splice(index, 1);
        saveConfig();
        return true;
    }
    return false;
}
/**
 * 启用/禁用规则
 */
function toggleRule(ruleId, enabled) {
    const rule = config.rules.find(r => r.id === ruleId);
    if (rule) {
        rule.enabled = enabled;
        saveConfig();
        return true;
    }
    return false;
}
/**
 * 列出所有规则
 */
function listRules() {
    return config.rules;
}
// ============ 默认规则 ============
const rules_1 = require("./rules");
// 初始化时加载配置
loadConfig();

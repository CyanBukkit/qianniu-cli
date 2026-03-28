/**
 * 规则引擎核心
 * 关键词匹配 + 自动回复
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ReplyRule {
  id: string;
  name: string;
  keywords: string[];      // 匹配的关键词（任一匹配即可）
  excludeKeywords?: string[]; // 排除关键词
  reply: string;          // 回复内容（如果是 RANDOM 则从 randomReplies 随机选择）
  randomReplies?: string[]; // 随机回复列表
  priority: number;       // 优先级（越大越优先）
  enabled: boolean;       // 是否启用
  requireAllKeywords?: boolean; // 是否需要所有关键词都匹配
}

export interface EngineConfig {
  rules: ReplyRule[];
  defaultReply: string;   // 未匹配时的默认回复（如果是 RANDOM 则从 defaultRandomReplies 随机选择）
  defaultRandomReplies?: string[]; // 默认随机回复列表
  enableLog: boolean;    // 是否打印日志
  cooldownSeconds: number; // 同一买家重复回复的冷却时间
}

// 默认配置
const DEFAULT_CONFIG: EngineConfig = {
  rules: [],
  defaultReply: '您好，感谢您的咨询！客服稍后会为您服务~',
  enableLog: true,
  cooldownSeconds: 30
};

const CONFIG_PATH = '/Users/liuyuxuanyi/Documents/qianniu-automation/data/reply-config.json';

// ============ 配置管理 ============

let config: EngineConfig = { ...DEFAULT_CONFIG };

/**
 * 加载配置
 */
export function loadConfig(): EngineConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      const loaded = JSON.parse(data);
      config = { ...DEFAULT_CONFIG, ...loaded };
      if (config.enableLog) {
        console.log(`📋 已加载 ${config.rules.length} 条规则`);
      }
    } else {
      // 使用默认规则
      config.rules = getDefaultRules();
      saveConfig();
    }
  } catch (e) {
    console.error('加载配置失败:', e);
    config = { ...DEFAULT_CONFIG, rules: getDefaultRules() };
  }
  return config;
}

/**
 * 保存配置
 */
export function saveConfig(): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * 获取当前配置
 */
export function getConfig(): EngineConfig {
  return config;
}

/**
 * 更新配置
 */
export function updateConfig(newConfig: Partial<EngineConfig>): void {
  config = { ...config, ...newConfig };
  saveConfig();
}

// ============ 规则匹配核心 ============

interface MatchResult {
  rule: ReplyRule;
  matchedKeyword: string;
  score: number;
}

// 记录每个买家的最后回复时间
const buyerLastReply: Record<string, number> = {};

/**
 * 清理过期的冷却记录
 */
function cleanupCooldown(): void {
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
function isInCooldown(buyerId: string): boolean {
  const lastReply = buyerLastReply[buyerId];
  if (!lastReply) return false;
  return Date.now() - lastReply < config.cooldownSeconds * 1000;
}

/**
 * 标记买家已回复
 */
function markReplied(buyerId: string): void {
  buyerLastReply[buyerId] = Date.now();
}

/**
 * 文本相似度计算（简单版）
 */
function calculateSimilarity(text1: string, text2: string): number {
  const s1 = text1.toLowerCase();
  const s2 = text2.toLowerCase();
  if (s2.includes(s1)) return 1;
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
function matchRule(message: string): MatchResult | null {
  const msgLower = message.toLowerCase();
  let bestMatch: MatchResult | null = null;

  // 按优先级排序
  const sortedRules = [...config.rules]
    .filter(r => r.enabled)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    // 检查排除关键词
    if (rule.excludeKeywords) {
      const hasExcluded = rule.excludeKeywords.some(k => 
        msgLower.includes(k.toLowerCase())
      );
      if (hasExcluded) continue;
    }

    let isMatch = false;
    let matchedKeyword = '';

    if (rule.requireAllKeywords) {
      // 需要所有关键词都匹配
      const allMatch = rule.keywords.every(k => 
        msgLower.includes(k.toLowerCase())
      );
      if (allMatch) {
        isMatch = true;
        matchedKeyword = rule.keywords[0];
      }
    } else {
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
export function generateReply(buyerId: string, message: string): string | null {
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

  let reply: string;
  if (match) {
    // 检查是否是随机回复
    if (match.rule.reply === 'RANDOM' && match.rule.randomReplies && match.rule.randomReplies.length > 0) {
      // 随机选择一条
      const idx = Math.floor(Math.random() * match.rule.randomReplies.length);
      reply = match.rule.randomReplies[idx];
      if (config.enableLog) {
        console.log(`🎲 随机回复 "${match.rule.name}" -> "${reply.substring(0, 20)}..."`);
      }
    } else {
      reply = match.rule.reply;
      if (config.enableLog) {
        console.log(`✅ 匹配规则 "${match.rule.name}" (${match.matchedKeyword})`);
      }
    }
  } else {
    // 默认回复支持 RANDOM
    if (config.defaultReply === 'RANDOM' && config.defaultRandomReplies) {
      const idx = Math.floor(Math.random() * config.defaultRandomReplies.length);
      reply = config.defaultRandomReplies[idx];
      if (config.enableLog) {
        console.log(`🎲 随机默认回复 -> "${reply.substring(0, 20)}..."`);
      }
    } else {
      reply = config.defaultReply;
      if (config.enableLog) {
        console.log(`📝 使用默认回复`);
      }
    }
  }

  // 标记已回复
  markReplied(buyerId);

  return reply;
}

/**
 * 手动触发回复（跳过冷却检查）
 */
export function forceReply(message: string): string {
  const match = matchRule(message);
  if (!match) {
    // 默认回复支持 RANDOM
    if (config.defaultReply === 'RANDOM' && config.defaultRandomReplies) {
      const idx = Math.floor(Math.random() * config.defaultRandomReplies.length);
      return config.defaultRandomReplies[idx];
    }
    return config.defaultReply;
  }
  
  // 规则回复支持 RANDOM
  if (match.rule.reply === 'RANDOM' && match.rule.randomReplies) {
    const idx = Math.floor(Math.random() * match.rule.randomReplies.length);
    return match.rule.randomReplies[idx];
  }
  return match.rule.reply;
}

/**
 * 添加规则
 */
export function addRule(rule: ReplyRule): void {
  config.rules.push(rule);
  saveConfig();
}

/**
 * 删除规则
 */
export function deleteRule(ruleId: string): boolean {
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
export function toggleRule(ruleId: string, enabled: boolean): boolean {
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
export function listRules(): ReplyRule[] {
  return config.rules;
}

// ============ 默认规则 ============

import { getDefaultRules } from './rules';

// 初始化时加载配置
loadConfig();

export { CONFIG_PATH };

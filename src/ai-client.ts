/**
 * AI 对接模块 (OpenAI 协议)
 * 支持异步回复，可对接任意 OpenAI 兼容 API
 * 使用 Node.js 内置 https 模块，无外部依赖
 */

import * as https from 'https';
import { URL } from 'url';
import { execSync } from 'child_process';

// ============ 配置 ============

const AI_API_URL = 'http://127.0.0.1:18789/v1/chat/completions';
const AI_API_KEY = 'a0fa68aa50e017912fae7941822f7a1842dba7b05e156dc3';
const DEFAULT_MODEL = 'openclaw';
const AI_TIMEOUT_MS = 3 * 60 * 1000; // 3分钟超时

// ============ 类型定义 ============

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIRequestOptions {
  model?: string;
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface AIResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============ 内部方法 ============

/**
 * 发起 HTTPS POST 请求（支持超时）
 */
function postJSON(
  url: string,
  apiKey: string,
  body: object,
  timeoutMs: number = AI_TIMEOUT_MS
): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : require('http');

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(JSON.stringify(body)),
      },
    };

    const req = lib.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    // 超时处理
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    }, timeoutMs);

    req.on('error', (err: any) => {
      clearTimeout(timer);
      reject(err);
    });

    req.on('close', () => {
      clearTimeout(timer);
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * 播放提示音
 */
function playNotificationSound(): void {
  try {
    execSync('afplay /System/Library/Sounds/Blow.so', { encoding: 'utf8' });
  } catch {
    // 忽略播放失败
  }
}

// ============ 核心方法 ============

/**
 * 同步调用 AI（等待完整回复）
 */
export async function askAI(options: AIRequestOptions): Promise<AIResponse> {
  const { model = DEFAULT_MODEL, messages, temperature = 0.7, max_tokens = 2000 } = options;

  const data = await postJSON(AI_API_URL, AI_API_KEY, {
    model,
    messages,
    temperature,
    max_tokens,
    stream: false,
  });

  return {
    content: data.choices?.[0]?.message?.content || '',
    model: data.model || model,
    usage: data.usage,
  };
}

/**
 * 异步调用 AI（不等待回复）
 * 适用于千牛自动化中后台处理
 * 超时3分钟，返回安抚消息并播放提示音
 */
export function askAIAsync(
  options: AIRequestOptions,
  callback: (response: AIResponse) => void
): void {
  const { model = DEFAULT_MODEL, messages, temperature = 0.7, max_tokens = 2000 } = options;

  postJSON(AI_API_URL, AI_API_KEY, {
    model,
    messages,
    temperature,
    max_tokens,
    stream: false,
  })
    .then((data) => {
      const aiContent = data.choices?.[0]?.message?.content || '';
      const prefixedContent = aiContent ? `CyanBukkit香果智能客服: ${aiContent}` : '';
      callback({
        content: prefixedContent,
        model: data.model || model,
        usage: data.usage,
      });
    })
    .catch((error: Error) => {
      console.error('❌ AI 请求失败:', error.message);
      if (error.message === 'TIMEOUT') {
        console.log('⏰ AI 请求超时，返回安抚消息并播放提示音');
        playNotificationSound();
        callback({ content: '我没理解你的问题请等一下', model });
      } else {
        callback({ content: '', model });
      }
    });
}

/**
 * 快捷方法：发送单条消息给 AI，返回回复
 */
export async function chat(
  userMessage: string,
  systemPrompt?: string
): Promise<string> {
  const messages: Message[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: userMessage });

  const response = await askAI({ messages });
  return response.content;
}

/**
 * 带上下文的对话（维护消息历史）
 */
export class AIChatSession {
  private messages: Message[] = [];
  private systemPrompt?: string;

  constructor(systemPrompt?: string) {
    this.systemPrompt = systemPrompt;
    if (systemPrompt) {
      this.messages.push({ role: 'system', content: systemPrompt });
    }
  }

  async send(message: string): Promise<string> {
    this.messages.push({ role: 'user', content: message });
    const response = await askAI({ messages: this.messages });
    this.messages.push({ role: 'assistant', content: response.content });
    return response.content;
  }

  sendAsync(message: string, callback: (reply: string) => void): void {
    this.messages.push({ role: 'user', content: message });
    askAIAsync({ messages: this.messages }, (response) => {
      this.messages.push({ role: 'assistant', content: response.content });
      callback(response.content);
    });
  }

  clear(): void {
    this.messages = this.systemPrompt
      ? [{ role: 'system', content: this.systemPrompt }]
      : [];
  }

  getHistory(): Message[] {
    return [...this.messages];
  }
}

// ============ 示例用法 ============

// 单独调用
// async function test() {
//   const reply = await chat('你好，帮我写一段自我介绍');
//   console.log('AI 回复:', reply);
// }

// 异步调用
// askAIAsync({ messages: [{ role: 'user', content: '你好' }] }, (res) => {
//   console.log('异步回复:', res.content);
// });

// 带上下文的对话
// const session = new AIChatSession('你是一个客服，回复要简洁专业');
// const reply = await session.send('我想咨询一下商品价格');
// console.log(reply);

export { AI_API_URL, AI_API_KEY, DEFAULT_MODEL };

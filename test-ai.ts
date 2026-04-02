/**
 * AI 对接测试
 * 运行: npx ts-node test-ai.ts
 */

import { chat, askAIAsync, AIChatSession } from './ai-client';

async function testSync() {
  console.log('🔄 测试同步调用...');
  try {
    const reply = await chat('你好，请用一句话介绍自己');
    console.log('✅ 回复:', reply);
  } catch (e) {
    console.error('❌ 失败:', e);
  }
}

function testAsync() {
  console.log('🔄 测试异步调用...');
  askAIAsync(
    { messages: [{ role: 'user', content: '你好' }] },
    (res) => {
      console.log('✅ 异步回复:', res.content);
    }
  );
}

function testSession() {
  console.log('🔄 测试会话上下文...');
  const session = new AIChatSession('你是一个热情的客服，用友好语气回复');

  session.send('我想买一件T恤').then((r1) => {
    console.log('用户: 我想买一件T恤');
    console.log('客服:', r1);

    session.send('有什么颜色可选？').then((r2) => {
      console.log('用户: 有什么颜色可选？');
      console.log('客服:', r2);
    });
  });
}

// 执行测试
(async () => {
  await testSync();
  testAsync();
  testSession();
})();

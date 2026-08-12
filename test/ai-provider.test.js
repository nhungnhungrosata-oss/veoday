import assert from 'node:assert/strict';
import test from 'node:test';

import { generateAIText, getProviderConfig, toErrorResponse } from '../lib/ai-provider.js';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

test('đọc đúng key đánh số, key cũ và loại bỏ key trùng', () => {
  const config = getProviderConfig({
    AI_PROVIDER_ORDER: 'deepseek,gemini,openai',
    GEMINI_API_KEY: 'AIza-main',
    GEMINI_API_KEY_1: 'AIza-one',
    GEMINI_KEY_1: 'AIza-one',
    DEEPSEEK_API_KEY: 'sk-deepseek',
  });

  assert.deepEqual(config.order, ['deepseek', 'gemini', 'openai']);
  assert.deepEqual(config.gemini.keys, ['AIza-main', 'AIza-one']);
  assert.deepEqual(config.deepseek.keys, ['sk-deepseek']);
});

test('xoay sang Gemini key tiếp theo khi key đầu hết quota', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('AIza-quota-a')) {
      return jsonResponse({ error: { status: 'RESOURCE_EXHAUSTED', message: 'free_tier_requests per day' } }, 429);
    }
    return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
  };

  const result = await generateAIText({
    prompt: 'test',
    env: {
      GEMINI_API_KEY: 'AIza-quota-a',
      GEMINI_API_KEY_1: 'AIza-success-b',
      AI_REQUEST_TIMEOUT_MS: '5000',
    },
  });

  assert.equal(result.provider, 'gemini');
  assert.equal(result.keyIndex, 2);
  assert.equal(result.text, '{"ok":true}');
  assert.equal(calls.length, 2);
});

test('tự động fallback từ Gemini 429 sang DeepSeek trả phí', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('googleapis.com')) {
      return jsonResponse({
        error: {
          status: 'RESOURCE_EXHAUSTED',
          message: 'Quota exceeded for generate_content_free_tier_requests',
          details: [{ retryDelay: '22s' }],
        },
      }, 429);
    }
    return jsonResponse({ choices: [{ message: { content: '{"fallback":"deepseek"}' } }] });
  };

  const result = await generateAIText({
    prompt: 'test fallback',
    env: {
      GEMINI_API_KEY: 'AIza-quota-c',
      DEEPSEEK_API_KEY: 'sk-paid-c',
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
      AI_PROVIDER_ORDER: 'gemini,deepseek,openai',
      AI_REQUEST_TIMEOUT_MS: '5000',
    },
  });

  assert.equal(result.provider, 'deepseek');
  assert.equal(result.model, 'deepseek-v4-flash');
  assert.equal(result.text, '{"fallback":"deepseek"}');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer sk-paid-c');

  const secondResult = await generateAIText({
    prompt: 'test fallback lần hai',
    env: {
      GEMINI_API_KEY: 'AIza-quota-c',
      DEEPSEEK_API_KEY: 'sk-paid-c',
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
      AI_PROVIDER_ORDER: 'gemini,deepseek,openai',
      AI_REQUEST_TIMEOUT_MS: '5000',
    },
  });
  assert.equal(secondResult.provider, 'deepseek');
  assert.equal(calls.length, 3, 'key Gemini đang cooldown phải được bỏ qua');
  assert.ok(calls[2].url.includes('api.deepseek.com'));
});

test('trả lỗi tổng hợp có cấu trúc khi mọi provider đều thất bại', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    const provider = String(url).includes('googleapis.com') ? 'Gemini' : 'DeepSeek';
    return jsonResponse({ error: { message: `${provider} unavailable` } }, 503);
  };

  await assert.rejects(
    generateAIText({
      prompt: 'test failures',
      env: {
        GEMINI_API_KEY: 'AIza-fail-d',
        DEEPSEEK_API_KEY: 'sk-fail-d',
        AI_REQUEST_TIMEOUT_MS: '5000',
      },
    }),
    (error) => {
      const response = toErrorResponse(error);
      assert.equal(response.status, 502);
      assert.equal(response.body.code, 'ALL_PROVIDERS_FAILED');
      assert.deepEqual(response.body.attempts.map((item) => item.provider), ['gemini', 'deepseek']);
      return true;
    },
  );
});

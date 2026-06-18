const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const uniqueKeys = (keys) => {
  const seen = new Set();
  return keys
    .map((k) => (typeof k === 'string' ? k.trim() : ''))
    .filter(Boolean)
    .filter((k) => {
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
};

const envKeys = (...names) => uniqueKeys(names.map((name) => process.env[name]));

const getGeminiKeys = () =>
  envKeys(
    'GEMINI_API_KEY',
    'GEMINI_API_KEY_1',
    'GEMINI_API_KEY_2',
    'GEMINI_API_KEY_3',
    'GEMINI_API_KEY_4',
    'GEMINI_API_KEY_5',
    'GEMINI_API_KEY_PAID',
    // Backward compatible: still read old VITE_* env if you already configured them.
    'VITE_GEMINI_API_KEY',
    'VITE_GEMINI_API_KEY_1',
    'VITE_GEMINI_API_KEY_2',
    'VITE_GEMINI_API_KEY_3',
    'VITE_GEMINI_API_KEY_4',
    'VITE_GEMINI_API_KEY_5',
    'VITE_GEMINI_API_KEY_PAID'
  ).filter((k) => k.startsWith('AIza'));

const getDeepSeekKeys = () =>
  envKeys(
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_API_KEY_1',
    'DEEPSEEK_API_KEY_2',
    'DEEPSEEK_API_KEY_3',
    'DEEPSEEK_API_KEY_4',
    'DEEPSEEK_API_KEY_5',
    'VITE_DEEPSEEK_API_KEY',
    'VITE_DEEPSEEK_API_KEY_1',
    'VITE_DEEPSEEK_API_KEY_2',
    'VITE_DEEPSEEK_API_KEY_3',
    'VITE_DEEPSEEK_API_KEY_4',
    'VITE_DEEPSEEK_API_KEY_5'
  );

const getOpenAIKeys = () =>
  envKeys(
    'OPENAI_API_KEY',
    'OPENAI_API_KEY_1',
    'OPENAI_API_KEY_2',
    'OPENAI_API_KEY_3',
    'OPENAI_API_KEY_4',
    'OPENAI_API_KEY_5',
    'VITE_OPENAI_API_KEY',
    'VITE_OPENAI_API_KEY_1',
    'VITE_OPENAI_API_KEY_2',
    'VITE_OPENAI_API_KEY_3',
    'VITE_OPENAI_API_KEY_4',
    'VITE_OPENAI_API_KEY_5'
  );

const errText = (err) => `${err?.status ?? ''} ${err?.code ?? ''} ${err?.message ?? ''}`.toLowerCase();
const isQuotaError = (err) => {
  const text = errText(err);
  return (
    err?.status === 429 ||
    text.includes('429') ||
    text.includes('quota') ||
    text.includes('rate_limit') ||
    text.includes('rate limit') ||
    text.includes('resource_exhausted') ||
    text.includes('insufficient_quota') ||
    text.includes('insufficient balance') ||
    text.includes('balance')
  );
};
const isKeyError = (err) => {
  const text = errText(err);
  return (
    err?.status === 400 ||
    err?.status === 401 ||
    err?.status === 403 ||
    text.includes('api key') ||
    text.includes('invalid') ||
    text.includes('unauthorized') ||
    text.includes('forbidden') ||
    text.includes('permission') ||
    text.includes('billing')
  );
};
const shouldTryNextKey = (err) => isQuotaError(err) || isKeyError(err) || err?.name === 'AbortError';

async function fetchWithTimeout(url, options, timeoutMs = 65000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiText(model, prompt, key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini empty response');
  return text;
}

async function callOpenAICompat(endpoint, apiKey, model, prompt) {
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Empty response');
  return text;
}

async function callKeyPool(providerName, keys, caller) {
  let lastErr;
  for (const [index, key] of keys.entries()) {
    try {
      return { text: await caller(key), provider: providerName, keyIndex: index + 1 };
    } catch (err) {
      lastErr = err;
      if (shouldTryNextKey(err)) {
        console.warn(`[AI Proxy] ${providerName} key #${index + 1} lỗi/hết quota → thử key tiếp`);
        if (isQuotaError(err)) await sleep(350);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error(`${providerName} chưa cấu hình key.`);
}

async function generateViaProxy({ model, prompt }) {
  if (!prompt || typeof prompt !== 'string') throw new Error('Thiếu prompt.');
  const geminiModel = model || process.env.GEMINI_MODEL || process.env.VITE_GEMINI_MODEL || 'gemini-2.5-flash';
  const deepseekModel = process.env.DEEPSEEK_MODEL || process.env.VITE_DEEPSEEK_MODEL || 'deepseek-chat';
  const openaiModel = process.env.OPENAI_MODEL || process.env.VITE_OPENAI_MODEL || 'gpt-4o-mini';

  let lastFallbackErr;
  const geminiKeys = getGeminiKeys();
  const deepseekKeys = getDeepSeekKeys();
  const openaiKeys = getOpenAIKeys();

  if (geminiKeys.length > 0) {
    try {
      return await callKeyPool('Gemini', geminiKeys, (key) => callGeminiText(geminiModel, prompt, key));
    } catch (err) {
      lastFallbackErr = err;
      if (!shouldTryNextKey(err)) throw err;
      console.warn('[AI Proxy] Tất cả Gemini key lỗi/hết quota → chuyển DeepSeek');
    }
  }

  if (deepseekKeys.length > 0) {
    try {
      return await callKeyPool('DeepSeek', deepseekKeys, (key) =>
        callOpenAICompat('https://api.deepseek.com/chat/completions', key, deepseekModel, prompt)
      );
    } catch (err) {
      lastFallbackErr = err;
      if (!shouldTryNextKey(err)) throw err;
      console.warn('[AI Proxy] Tất cả DeepSeek key lỗi/hết quota → chuyển OpenAI');
    }
  }

  if (openaiKeys.length > 0) {
    return await callKeyPool('OpenAI', openaiKeys, (key) =>
      callOpenAICompat('https://api.openai.com/v1/chat/completions', key, openaiModel, prompt)
    );
  }

  throw lastFallbackErr || new Error('Chưa cấu hình API key server-side. Hãy thêm GEMINI_API_KEY hoặc DEEPSEEK_API_KEY trong Environment Variables.');
}

export { generateViaProxy };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const result = await generateViaProxy(req.body || {});
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[AI Proxy]', err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: err?.message || 'AI proxy failed',
      retryable: shouldTryNextKey(err),
    });
  }
}

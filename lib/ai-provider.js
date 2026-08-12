const PROVIDERS = ['gemini', 'deepseek', 'openai'];
const providerCursor = new Map();
const keyCooldownUntil = new Map();

function uniqueKeys(keys) {
  const seen = new Set();
  return keys
    .map((key) => (typeof key === 'string' ? key.trim() : ''))
    .filter(Boolean)
    .filter((key) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function readNumberedKeys(env, prefix, max = 10) {
  const keys = [env[prefix]];
  for (let index = 1; index <= max; index += 1) keys.push(env[`${prefix}_${index}`]);
  return keys;
}

function parseProviderOrder(value) {
  const requested = String(value || 'gemini,deepseek,openai')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((provider) => PROVIDERS.includes(provider));
  return [...new Set([...requested, ...PROVIDERS])];
}

export function getProviderConfig(env = process.env) {
  return {
    order: parseProviderOrder(env.AI_PROVIDER_ORDER),
    timeoutMs: Math.min(60_000, Math.max(5_000, Number(env.AI_REQUEST_TIMEOUT_MS) || 30_000)),
    gemini: {
      keys: uniqueKeys([
        ...readNumberedKeys(env, 'GEMINI_API_KEY'),
        env.GEMINI_API_KEY_PAID,
        ...readNumberedKeys(env, 'GEMINI_KEY'),
        ...readNumberedKeys(env, 'VITE_GEMINI_API_KEY'),
      ]).filter((key) => key.startsWith('AIza')),
      model: env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
    deepseek: {
      keys: uniqueKeys([
        ...readNumberedKeys(env, 'DEEPSEEK_API_KEY'),
        ...readNumberedKeys(env, 'VITE_DEEPSEEK_API_KEY'),
      ]),
      model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    },
    openai: {
      keys: uniqueKeys([
        ...readNumberedKeys(env, 'OPENAI_API_KEY'),
        ...readNumberedKeys(env, 'VITE_OPENAI_API_KEY'),
      ]),
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
    },
  };
}

class AIProviderError extends Error {
  constructor(provider, message, status = 502, code = 'PROVIDER_ERROR', retryAfterMs = 0) {
    super(message);
    this.name = 'AIProviderError';
    this.provider = provider;
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

function extractErrorMessage(body, fallback) {
  return String(body?.error?.message || body?.message || body?.error || fallback).slice(0, 500);
}

function retryAfterMs(response, body) {
  const headerSeconds = Number(response.headers.get('retry-after'));
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) return headerSeconds * 1000;

  const retryDelay = body?.error?.details?.find((detail) => detail?.retryDelay)?.retryDelay;
  const bodySeconds = Number.parseFloat(String(retryDelay || '').replace(/[^\d.]/g, ''));
  if (Number.isFinite(bodySeconds) && bodySeconds > 0) return bodySeconds * 1000;
  return 0;
}

async function postJSON(provider, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = extractErrorMessage(body, `HTTP ${response.status}`);
      throw new AIProviderError(
        provider,
        message,
        response.status,
        body?.error?.status || body?.error?.code || 'HTTP_ERROR',
        retryAfterMs(response, body),
      );
    }
    return body;
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    if (error?.name === 'AbortError') {
      throw new AIProviderError(provider, `Quá thời gian chờ ${Math.round(timeoutMs / 1000)} giây.`, 504, 'TIMEOUT');
    }
    throw new AIProviderError(provider, error?.message || 'Không kết nối được nhà cung cấp AI.', 502, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(key, model, prompt, timeoutMs) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = await postJSON('gemini', url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
    }),
  }, timeoutMs);
  const text = body?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('').trim();
  if (!text) throw new AIProviderError('gemini', 'Gemini trả về nội dung rỗng.', 502, 'EMPTY_RESPONSE');
  return text;
}

async function callOpenAICompatible(provider, key, endpoint, model, prompt, timeoutMs) {
  const body = await postJSON(provider, endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      stream: false,
    }),
  }, timeoutMs);
  const text = body?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new AIProviderError(provider, `${provider} trả về nội dung rỗng.`, 502, 'EMPTY_RESPONSE');
  return text;
}

function rotatedAvailableKeys(provider, keys) {
  const start = providerCursor.get(provider) || 0;
  const rotated = keys.map((_, offset) => {
    const index = (start + offset) % keys.length;
    return { key: keys[index], index };
  });
  const now = Date.now();
  return rotated.filter(({ key }) => (keyCooldownUntil.get(`${provider}:${key}`) || 0) <= now);
}

function markKeyResult(provider, key, index, error, keyCount) {
  providerCursor.set(provider, (index + 1) % keyCount);
  if (error?.status !== 429) return;
  const isDailyQuota = /per.?day|requestsperday|free.tier.requests/i.test(`${error.message} ${error.code}`);
  const defaultCooldown = isDailyQuota ? 15 * 60_000 : 60_000;
  keyCooldownUntil.set(`${provider}:${key}`, Date.now() + Math.max(error.retryAfterMs || 0, defaultCooldown));
}

async function callWithKeyRotation(provider, settings, prompt, timeoutMs) {
  let lastError;
  const availableKeys = rotatedAvailableKeys(provider, settings.keys);
  if (availableKeys.length === 0) {
    throw new AIProviderError(provider, `Các key ${provider} đang tạm ngưng sau lỗi giới hạn; chuyển provider.`, 429, 'KEYS_COOLING_DOWN');
  }
  for (const { key, index } of availableKeys) {
    try {
      let text;
      if (provider === 'gemini') text = await callGemini(key, settings.model, prompt, timeoutMs);
      else if (provider === 'deepseek') {
        text = await callOpenAICompatible(provider, key, 'https://api.deepseek.com/chat/completions', settings.model, prompt, timeoutMs);
      } else {
        text = await callOpenAICompatible(provider, key, 'https://api.openai.com/v1/chat/completions', settings.model, prompt, timeoutMs);
      }
      providerCursor.set(provider, (index + 1) % settings.keys.length);
      return { text, keyIndex: index + 1, model: settings.model };
    } catch (error) {
      lastError = error;
      markKeyResult(provider, key, index, error, settings.keys.length);
      console.warn(`[AI] ${provider} key #${index + 1} lỗi (${error.status || 'unknown'}); chuyển key/provider.`);
    }
  }
  throw lastError || new AIProviderError(provider, `Chưa cấu hình API key cho ${provider}.`, 500, 'MISSING_KEY');
}

function publicAttempt(error) {
  return {
    provider: error?.provider || 'unknown',
    status: Number(error?.status) || 502,
    code: String(error?.code || 'PROVIDER_ERROR'),
    message: String(error?.message || 'Lỗi không xác định.').slice(0, 300),
  };
}

export async function generateAIText({ prompt, requestedGeminiModel, env = process.env }) {
  if (!prompt || typeof prompt !== 'string') {
    throw new AIProviderError('request', 'Thiếu prompt.', 400, 'INVALID_REQUEST');
  }

  const config = getProviderConfig(env);
  if (requestedGeminiModel && /^gemini[-.]/i.test(requestedGeminiModel)) {
    config.gemini.model = requestedGeminiModel;
  }

  const attempts = [];
  for (const provider of config.order) {
    const settings = config[provider];
    if (!settings.keys.length) continue;
    try {
      const result = await callWithKeyRotation(provider, settings, prompt, config.timeoutMs);
      return { ok: true, provider, ...result };
    } catch (error) {
      attempts.push(publicAttempt(error));
    }
  }

  if (attempts.length === 0) {
    const error = new AIProviderError('configuration', 'Chưa cấu hình API key AI trên server.', 500, 'NO_AI_KEYS');
    error.attempts = [];
    throw error;
  }

  const allRateLimited = attempts.every((attempt) => attempt.status === 429);
  const summary = attempts.map((attempt) => `${attempt.provider}: ${attempt.status}`).join(' → ');
  const error = new AIProviderError(
    'fallback',
    `Không nhà cung cấp AI nào hoàn tất yêu cầu (${summary}).`,
    allRateLimited ? 429 : 502,
    allRateLimited ? 'ALL_PROVIDERS_RATE_LIMITED' : 'ALL_PROVIDERS_FAILED',
  );
  error.attempts = attempts;
  throw error;
}

export function toErrorResponse(error) {
  return {
    status: Number(error?.status) || 500,
    body: {
      ok: false,
      error: error?.message || 'Lỗi server AI.',
      code: error?.code || 'AI_ERROR',
      attempts: Array.isArray(error?.attempts) ? error.attempts : undefined,
    },
  };
}

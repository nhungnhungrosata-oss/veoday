import { GoogleGenAI } from '@google/genai';
import { AppState, GeneratedResult, StyleType } from '../types';
import { v4 as uuidv4 } from 'uuid';

const E: ImportMetaEnv = import.meta.env;

const IDENTITY_LOCK =
  'Based on the reference image. Same person, same identity, same face, same hairstyle, same outfit, same background, same environment, same pose, same body position, same body orientation, same framing, and same camera angle. Maintain 100% character consistency and scene consistency. No morphing, no identity change, no outfit change, no background change, no pose change.';

const VOICE_DIRECTION: Record<string, string> = {
  Bắc: 'The person is speaking Vietnamese with a clear, standard Northern Vietnamese accent (giọng Bắc Hà Nội). Speech is articulate and natural. Natural lip movements perfectly synchronized with the speech rhythm.',
  Nam: 'The person is speaking Vietnamese with a clear, standard Southern Vietnamese accent (giọng Nam). Speech is fluid and natural. Natural lip movements perfectly synchronized with the speech rhythm.',
  Trung: 'The person is speaking Vietnamese with a clear, intelligible Central Vietnamese accent (giọng Trung phổ thông). Speech is authentic and natural. Natural lip movements perfectly synchronized with the speech rhythm.',
};

const STYLE_DIRECTION: Record<StyleType, string> = {
  energy: 'The overall tone is high-energy, enthusiastic, vibrant, persuasive, and dynamic.',
  professional: 'The overall tone is professional, confident, authoritative, clear, calm, and trustworthy.',
  gentle: 'The overall tone is soft, warm, emotional, soothing, intimate, and reflective.',
  natural: 'The overall tone is casual, friendly, approachable, relaxed, and conversational.',
};

const FIXED_VIDEO_DIRECTION =
  'Preserve the exact pose and body position from the reference image. Do not force the person to sit, stand, turn, walk, change posture, or reposition the hands or body. Keep the original framing, camera angle, body orientation, background, and environment unchanged. Static camera, locked shot, no zoom, no pan. Allow only natural lip sync, subtle facial micro-expressions, natural eye blinking every 3-4 seconds, and very small realistic head movements that do not alter the original pose. No extra hand gestures that change the reference pose. Photorealistic rendering. No text overlay, no watermark.';

type ApiKeyItem = { key: string; active?: boolean };
type LocalProvider = 'google' | 'deepseek' | 'openai';
type LocalApiConfig = Partial<Record<LocalProvider, { keys?: ApiKeyItem[]; model?: string }>> & {
  providerOrder?: LocalProvider[];
};

function uniqueKeys(keys: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  return keys
    .map((key) => (typeof key === 'string' ? key.trim() : ''))
    .filter(Boolean)
    .filter((key) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function readLocalApiConfig(): LocalApiConfig {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem('api_key_manager_v1');
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      const bytes = Uint8Array.from(window.atob(raw), (character) => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    }
  } catch {
    return {};
  }
}

function readLocalProviderKeys(provider: LocalProvider): string[] {
  try {
    const config = readLocalApiConfig();
    const keys = config?.[provider]?.keys;
    if (!Array.isArray(keys)) return [];
    return uniqueKeys(
      keys
        .filter((item: ApiKeyItem) => item && item.active !== false)
        .map((item: ApiKeyItem) => item.key)
    );
  } catch {
    return [];
  }
}

function readLocalProviderModel(provider: LocalProvider, fallback: string): string {
  const model = readLocalApiConfig()?.[provider]?.model;
  return typeof model === 'string' && model.trim() ? model.trim() : fallback;
}

function readLocalProviderOrder(): LocalProvider[] {
  const configured = readLocalApiConfig()?.providerOrder;
  const defaults: LocalProvider[] = ['google', 'deepseek', 'openai'];
  if (!Array.isArray(configured)) return defaults;
  const valid = configured.filter((provider): provider is LocalProvider => defaults.includes(provider));
  return [...new Set([...valid, ...defaults])];
}

const GEMINI_KEYS = uniqueKeys([
  E.VITE_GEMINI_API_KEY,
  E.VITE_GEMINI_API_KEY_1,
  E.VITE_GEMINI_API_KEY_2,
  E.VITE_GEMINI_API_KEY_3,
  E.VITE_GEMINI_API_KEY_4,
  E.VITE_GEMINI_API_KEY_5,
  // Compatibility with old Vite define in vite.config.ts
  // @ts-ignore
  typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : undefined,
  ...readLocalProviderKeys('google'),
]).filter((key) => key.startsWith('AIza'));

const DEEPSEEK_KEYS = uniqueKeys([
  E.VITE_DEEPSEEK_API_KEY,
  E.VITE_DEEPSEEK_API_KEY_1,
  E.VITE_DEEPSEEK_API_KEY_2,
  ...readLocalProviderKeys('deepseek'),
]);

const OPENAI_KEYS = uniqueKeys([
  E.VITE_OPENAI_API_KEY,
  E.VITE_OPENAI_API_KEY_1,
  E.VITE_OPENAI_API_KEY_2,
  ...readLocalProviderKeys('openai'),
]);

const errText = (err: any) => `${err?.status ?? ''} ${err?.code ?? ''} ${err?.message ?? ''}`.toLowerCase();
const shouldTryNextKey = (err: any) => {
  const text = errText(err);
  return err?.status === 429 || err?.status === 400 || err?.status === 401 || err?.status === 403 || text.includes('quota') || text.includes('rate') || text.includes('invalid') || text.includes('api key') || text.includes('billing') || text.includes('permission');
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function trimWords(text: string, maxWords: number): string {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  let out = words.slice(0, maxWords).join(' ');
  out = out.replace(/[,.!?;:…]+$/g, '');
  return `${out}.`;
}

function getVoiceWordLimit(videoModel: string) {
  // Fix: Veo 3 chỉ 8 giây, lời thoại phải ngắn. Chặn cứng tối đa 28 từ/cảnh.
  if (videoModel === 'Veo 3') return { minWords: 18, maxWords: 28, seconds: 8 };
  return { minWords: 24, maxWords: 36, seconds: 10 };
}

function buildVoiceStylePrompt(voice: string, style: StyleType): string {
  return `${VOICE_DIRECTION[voice] || VOICE_DIRECTION.Bắc} ${STYLE_DIRECTION[style] || STYLE_DIRECTION.professional}`;
}

function buildFixedVideoPrompt(state: AppState, hasRefImage: boolean): string {
  const parts = [
    hasRefImage ? IDENTITY_LOCK : '',
    buildVoiceStylePrompt(state.voice, state.style || 'professional'),
    FIXED_VIDEO_DIRECTION,
  ];
  return parts.filter(Boolean).join(' ');
}

function extractJSON(text: string): any {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('AI không trả về JSON hợp lệ.');
  }
}

async function callBackendProxyText(model: string, prompt: string): Promise<string> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ model, prompt }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message;
    const details = Array.isArray(data?.attempts)
      ? ` ${data.attempts.map((item: any) => `${item.provider}: ${item.status}`).join(' → ')}`
      : '';
    const err: any = new Error(`${message || `Proxy HTTP ${res.status}`}${details}`.trim());
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  if (!data?.text) throw new Error('AI proxy không trả về nội dung.');
  return data.text;
}

async function callGeminiText(model: string, prompt: string): Promise<string> {
  let lastErr: any;
  for (const [index, key] of GEMINI_KEYS.entries()) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0.7 },
      });
      if (res.text) return res.text;
      throw new Error('AI trả về rỗng.');
    } catch (err: any) {
      lastErr = err;
      if (shouldTryNextKey(err)) {
        console.warn(`[AI] Gemini key #${index + 1} lỗi/hết quota, thử key tiếp.`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Chưa cấu hình Gemini API Key.');
}

async function callOpenAICompat(endpoint: string, apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callProviderKeys(provider: 'DeepSeek' | 'OpenAI', keys: string[], endpoint: string, model: string, prompt: string): Promise<string> {
  let lastErr: any;
  for (const [index, key] of keys.entries()) {
    try {
      return await callOpenAICompat(endpoint, key, model, prompt);
    } catch (err: any) {
      lastErr = err;
      if (shouldTryNextKey(err)) {
        console.warn(`[AI] ${provider} key #${index + 1} lỗi/hết quota, thử key tiếp.`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error(`Chưa cấu hình ${provider} API Key.`);
}

async function callAIText(model: string, prompt: string): Promise<string> {
  const useProxy = E.VITE_USE_AI_PROXY !== 'false';
  if (useProxy && typeof window !== 'undefined') {
    try {
      return await callBackendProxyText(model, prompt);
    } catch (err) {
      const hasFallbackKeys = GEMINI_KEYS.length > 0 || DEEPSEEK_KEYS.length > 0 || OPENAI_KEYS.length > 0;
      if (!hasFallbackKeys) throw err;
      console.warn('[AI] Proxy lỗi hoặc chưa có /api/generate, chuyển sang key browser.', err);
    }
  }

  let lastError: any;
  for (const provider of readLocalProviderOrder()) {
    try {
      if (provider === 'google' && GEMINI_KEYS.length > 0) return await callGeminiText(model, prompt);
      if (provider === 'deepseek' && DEEPSEEK_KEYS.length > 0) {
        const deepSeekModel = E.VITE_DEEPSEEK_MODEL || readLocalProviderModel('deepseek', 'deepseek-v4-flash');
        return await callProviderKeys('DeepSeek', DEEPSEEK_KEYS, 'https://api.deepseek.com/chat/completions', deepSeekModel, prompt);
      }
      if (provider === 'openai' && OPENAI_KEYS.length > 0) {
        const openAIModel = E.VITE_OPENAI_MODEL || readLocalProviderModel('openai', 'gpt-4o-mini');
        return await callProviderKeys('OpenAI', OPENAI_KEYS, 'https://api.openai.com/v1/chat/completions', openAIModel, prompt);
      }
    } catch (error) {
      lastError = error;
      console.warn(`[AI] Provider ${provider} thất bại, chuyển provider tiếp theo.`, error);
    }
  }
  if (lastError) throw lastError;
  throw new Error('Chưa cấu hình API Key. Hãy thêm key trên server hoặc bật backend /api/generate.');
}

export async function suggestScripts(contentSnippet: string): Promise<string[]> {
  const text = contentSnippet.trim();
  if (wordCount(text) < 4) return [];
  const prompt = `Dựa trên nội dung sau, đề xuất 2 tiêu đề viral ngắn gọn cho video TikTok/Reels. Mỗi tiêu đề tối đa 18 từ, tiếng Việt, kích thích tò mò, không nhắc tên công cụ AI. Nội dung: "${text}". Trả về JSON: {"suggestions":["...","..."]}`;
  try {
    const raw = await callAIText('gemini-2.5-flash', prompt);
    const data = extractJSON(raw);
    const arr = Array.isArray(data?.suggestions) ? data.suggestions : [];
    return arr.map(String).slice(0, 3);
  } catch (err) {
    console.warn('[suggestScripts]', err);
    return [];
  }
}

function normalizeScenes(dataScenes: any[], sceneCount: number, fallbackContent: string) {
  const scenes = Array.isArray(dataScenes) ? dataScenes.slice(0, sceneCount) : [];
  while (scenes.length < sceneCount) {
    scenes.push({
      voiceScript: fallbackContent || 'Các mẹ nhớ để ý điều nhỏ này mỗi ngày nhé.',
    });
  }
  return scenes;
}

export async function generateContent(state: AppState): Promise<GeneratedResult> {
  const hasRefImage = state.selectedImageIndex !== null && state.images[state.selectedImageIndex] !== undefined;
  const { minWords, maxWords, seconds } = getVoiceWordLimit(state.videoModel);
  const fixedVideoPrompt = buildFixedVideoPrompt(state, hasRefImage);

  const prompt = `Bạn là chuyên gia viết kịch bản video ngắn cho TikTok/Reels/Shorts.

NHIỆM VỤ: Chỉ viết nội dung lời thoại cho ${state.sceneCount} cảnh. Mỗi cảnh dùng cho video ${seconds} giây. KHÔNG viết prompt tạo video, mô tả hình ảnh, góc máy, ánh sáng hoặc chuyển động camera vì các phần đó đã được hệ thống tạo cố định bằng code.

DỮ LIỆU:
- Nội dung chính: "${state.content}"
- Điều khiển thêm: "${state.notes || 'Không có'}"
- Giọng vùng miền được chọn: ${state.voice}
- Phong cách được chọn: ${state.style}
- Model video: ${state.videoModel}, thời lượng mỗi cảnh ${seconds} giây

QUY TẮC CỰC KỲ QUAN TRỌNG CHO LỜI THOẠI:
- voiceScript phải là tiếng Việt tự nhiên như người thật nói.
- Nội dung và cách diễn đạt phải phù hợp phong cách ${state.style} đã chọn.
- Mỗi voiceScript BẮT BUỘC từ ${minWords} đến ${maxWords} từ. Tuyệt đối KHÔNG vượt quá ${maxWords} từ.
- Riêng Veo 3 chỉ 8 giây, nên mỗi cảnh tối đa ${maxWords} từ. Câu ngắn, nói được trong 8 giây.
- Cảnh 1 phải có hook mạnh.
- Các cảnh nối tiếp nhau tự nhiên, không lặp ý.
- Cảnh cuối có kết luận hoặc CTA nhẹ, nhưng vẫn không vượt ${maxWords} từ.
- Không nhắc tên công cụ AI, phần mềm, nền tảng tạo video.
- Không đưa hashtag vào voiceScript.
- KHÔNG trả về videoPrompt.

THUMBNAIL:
- Tạo 3 tiêu đề thumbnail tiếng Việt, tối đa 45 ký tự/tiêu đề, gây tò mò, liên quan nội dung.

OUTPUT CHỈ JSON, không markdown, không giải thích:
{
  "hook": "hook tiếng Việt tối đa 15 từ",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "scenes": [
    {
      "voiceScript": "${minWords}-${maxWords} từ, không vượt ${maxWords} từ"
    }
  ],
  "thumbnailTexts": ["Tiêu đề 1", "Tiêu đề 2", "Tiêu đề 3"]
}`;

  const raw = await callAIText('gemini-2.5-flash', prompt);
  const data = extractJSON(raw);
  const scenes = normalizeScenes(data?.scenes, state.sceneCount, state.content).map((scene: any, index: number) => {
    let voiceScript = String(scene?.voiceScript || '').replace(/\s+/g, ' ').trim();
    voiceScript = trimWords(voiceScript, maxWords);

    // Nếu AI trả về quá ngắn hoặc rỗng, tạo câu fallback ngắn đúng giới hạn.
    if (wordCount(voiceScript) < 6) {
      voiceScript = index === 0
        ? trimWords(`Các mẹ ơi, có một điều nhỏ nhưng ảnh hưởng rất nhiều: ${state.content}`, maxWords)
        : trimWords('Mình chỉ cần làm đều mỗi ngày, thay đổi nhỏ thôi nhưng kết quả sẽ tốt hơn nhiều.', maxWords);
    }

    return { videoPrompt: fixedVideoPrompt, voiceScript };
  });

  const thumbnailTexts = Array.isArray(data?.thumbnailTexts) ? data.thumbnailTexts : [];

  return {
    id: uuidv4(),
    timestamp: Date.now(),
    hook: trimWords(String(data?.hook || state.content || 'Điều nhỏ này nhiều mẹ đang bỏ qua!'), 15),
    hashtags: Array.isArray(data?.hashtags) ? data.hashtags.slice(0, 5).map(String) : ['#mevabe', '#chamsoccon', '#dinhduong', '#suckhoe', '#videoAI'],
    scenes,
    thumbnailVariations: [0, 1, 2].map((i) => ({
      text: String(thumbnailTexts[i] || ['Điều mẹ dễ bỏ qua', 'Bí quyết chăm con khỏe', 'Làm đều mỗi ngày'][i]).slice(0, 60),
    })),
    inputs: state,
  };
}

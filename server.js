import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

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

const GEMINI_KEYS = uniqueKeys([
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
  process.env.VITE_GEMINI_API_KEY,
  process.env.VITE_GEMINI_API_KEY_1,
  process.env.VITE_GEMINI_API_KEY_2,
]).filter((key) => key.startsWith('AIza'));

function shouldTryNextKey(err) {
  const text = `${err?.status ?? ''} ${err?.code ?? ''} ${err?.message ?? ''}`.toLowerCase();
  return err?.status === 429 || err?.status === 400 || err?.status === 401 || err?.status === 403 || text.includes('quota') || text.includes('rate') || text.includes('invalid') || text.includes('api key') || text.includes('billing') || text.includes('permission');
}

app.post('/api/generate', async (req, res) => {
  try {
    const { model = 'gemini-2.5-flash', prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ ok: false, error: 'Thiếu prompt.' });
    }
    if (GEMINI_KEYS.length === 0) {
      return res.status(500).json({ ok: false, error: 'Chưa cấu hình GEMINI_API_KEY trên server.' });
    }

    let lastErr;
    for (const [index, key] of GEMINI_KEYS.entries()) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const result = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: 'application/json', temperature: 0.7 },
        });
        if (!result.text) throw new Error('AI trả về rỗng.');
        return res.json({ ok: true, provider: 'gemini', keyIndex: index + 1, text: result.text });
      } catch (err) {
        lastErr = err;
        if (shouldTryNextKey(err)) continue;
        break;
      }
    }

    return res.status(500).json({ ok: false, error: lastErr?.message || 'Không gọi được AI.' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Lỗi server AI.' });
  }
});

app.use(express.static(path.join(__dirname, 'dist'), { maxAge: '1h' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
app.listen(port, () => console.log(`Server running on ${port}`));

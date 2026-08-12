import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateAIText, toErrorResponse } from './lib/ai-provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

app.post('/api/generate', async (req, res) => {
  try {
    const { model = 'gemini-2.5-flash', prompt } = req.body || {};
    const result = await generateAIText({ prompt, requestedGeminiModel: model });
    return res.json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json(response.body);
  }
});

app.use(express.static(path.join(__dirname, 'dist'), { maxAge: '1h' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
app.listen(port, () => console.log(`Server running on ${port}`));

import { generateAIText, toErrorResponse } from '../lib/ai-provider.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Chỉ hỗ trợ phương thức POST.' });
  }

  try {
    const body = req.body || {};
    const prompt = body.prompt || body?.contents?.[0]?.parts?.[0]?.text;
    const result = await generateAIText({
      prompt,
      requestedGeminiModel: body.model,
    });
    return res.status(200).json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json(response.body);
  }
}

// api/claude.js — Gemini API proxy
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const GEMINI_KEY = 'AIzaSyCsz7qZrwRItKyAs7iB6wkK5cUD3xGZhnI';
  const { prompt } = req.body;

  if (!prompt) return res.status(400).json({ ok: false, error: 'no prompt' });

  // 嘗試多個 model 名稱，確保其中一個可用
  const MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-1.5-flash',
  ];

  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!r.ok) {
        console.log(`Model ${model} returned ${r.status}`);
        continue;
      }

      const d = await r.json();
      console.log(`Model ${model} response keys:`, Object.keys(d));

      // 嘗試多種路徑取得 text
      const text =
        d?.candidates?.[0]?.content?.parts?.[0]?.text ||
        d?.candidates?.[0]?.output ||
        d?.text || '';

      if (text) {
        console.log(`Model ${model} success, text length:`, text.length);
        return res.status(200).json({ ok: true, text, model });
      }

      // 回傳完整 response 幫助 debug
      console.log(`Model ${model} empty text, full response:`, JSON.stringify(d).slice(0, 500));
    } catch (e) {
      console.log(`Model ${model} error:`, e.message);
    }
  }

  return res.status(500).json({ ok: false, error: 'all models failed' });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = 'AIzaSyBb1yq0rIPbxbfKt78t-Kit6IsJYrn3U0Y';
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ ok: false, error: 'no prompt' });

  const ATTEMPTS = [
    { ver: 'v1',    model: 'gemini-2.0-flash' },
    { ver: 'v1',    model: 'gemini-1.5-flash' },
    { ver: 'v1',    model: 'gemini-1.5-flash-latest' },
    { ver: 'v1beta',model: 'gemini-2.5-flash-preview-04-17' },
  ];

  for (const { ver, model } of ATTEMPTS) {
    try {
      const url = `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${KEY}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
        }),
        signal: AbortSignal.timeout(15000),
      });
      const d = await r.json();
      console.log(`${ver}/${model}:`, r.status, JSON.stringify(d).slice(0, 200));
      const text = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text) return res.status(200).json({ ok: true, text, model });
    } catch(e) {
      console.log(`${model} error:`, e.message);
    }
  }

  return res.status(500).json({ ok: false, error: 'all models failed' });
}

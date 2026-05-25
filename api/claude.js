export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEYS = [
    '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',
    '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',
    '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',
  ];

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ ok: false, error: 'no prompt' });

  const MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-8b-8192',
    'gemma2-9b-it',
  ];

  const SYSTEM = '你是一位資深台灣股市基金經理人，勝率長期高於90%。擅長結合基本面、技術面、籌碼面分析。回答使用繁體中文，直接給結論，不說廢話。';

  for (const model of MODELS) {
    for (const key of KEYS) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user', content: prompt }
            ],
            max_tokens: 1200,
            temperature: 0.6,
          }),
          signal: AbortSignal.timeout(20000),
        });

        const d = await r.json();
        const ki = KEYS.indexOf(key) + 1;

        if (r.status === 429) {
          console.log(`${model} key${ki} rate limited`);
          continue;
        }

        if (!r.ok) {
          console.log(`${model} key${ki} status:${r.status}`);
          break;
        }

        const text = d?.choices?.[0]?.message?.content || '';
        if (text) {
          console.log(`${model} key${ki} success length:${text.length}`);
          return res.status(200).json({ ok: true, text, model });
        }

      } catch(e) {
        console.log(`${model} key${KEYS.indexOf(key)+1} error:`, e.message);
      }
    }
  }

  return res.status(500).json({ ok: false, error: 'all models and keys failed' });
}

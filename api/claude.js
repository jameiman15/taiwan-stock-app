export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const GROQ_KEY = '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';
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ ok: false, error: 'no prompt' });

  // 目前 Groq 支援的 model（2025年5月）
  const MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',      // 較小但快，rate limit 較寬
    'llama3-8b-8192',            // 備用
    'gemma2-9b-it',              // Google Gemma 備用
  ];

  for (const model of MODELS) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: '你是一位資深台灣股市基金經理人，勝率長期高於90%。擅長結合基本面、技術面、籌碼面分析。回答使用繁體中文，直接給結論，不說廢話。'
            },
            { role: 'user', content: prompt }
          ],
          max_tokens: 1200,
          temperature: 0.6,
        }),
        signal: AbortSignal.timeout(20000),
      });

      const d = await r.json();

      if (r.status === 429) {
        console.log(`${model} rate limited, trying next model`);
        await new Promise(resolve => setTimeout(resolve, 800));
        continue;
      }

      if (!r.ok) {
        console.log(`${model} status:${r.status}`, JSON.stringify(d).slice(0, 100));
        continue;
      }

      const text = d?.choices?.[0]?.message?.content || '';
      if (text) {
        console.log(`${model} success, length:${text.length}`);
        return res.status(200).json({ ok: true, text, model });
      }

    } catch(e) {
      console.log(`${model} error:`, e.message);
    }
  }

  return res.status(500).json({ ok: false, error: 'all models failed' });
}

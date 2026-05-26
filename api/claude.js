export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEYS = [
    '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',  // 填入 Key 1
    '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',  // 填入 Key 2
    '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',  // 填入 Key 3
  ].filter(k => k && !k.startsWith('YOUR_'));

  if (KEYS.length === 0) {
    return res.status(500).json({ ok: false, error: 'No API keys configured' });
  }

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ ok: false, error: 'no prompt' });

  const MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'gemma2-9b-it',
  ];

  const SYSTEM = '你是一位資深台灣股市基金經理人，擁有50年實戰經驗，勝率長期高於90%。擅長結合基本面、技術面、籌碼面三位一體分析。回答使用繁體中文，直接給結論，不說廢話。';

  for (const model of MODELS) {
    for (let ki = 0; ki < KEYS.length; ki++) {
      const key = KEYS[ki];
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
            max_tokens: 1500,
            temperature: 0.6,
          }),
          signal: AbortSignal.timeout(25000),
        });

        const d = await r.json();

        if (r.status === 429) {
          console.log(`${model} key${ki+1} rate limited, try next key`);
          continue; // 換下一個 key
        }
        if (r.status === 401) {
          console.log(`${model} key${ki+1} invalid/revoked, try next key`);
          continue; // 換下一個 key（不是 break）
        }
        if (!r.ok) {
          console.log(`${model} key${ki+1} status:${r.status}, try next model`);
          break; // 這個 model 有問題，換下一個 model
        }

        const text = d?.choices?.[0]?.message?.content || '';
        if (text) {
          console.log(`✅ ${model} key${ki+1} success length:${text.length}`);
          return res.status(200).json({ ok: true, text, model });
        }

      } catch(e) {
        console.log(`${model} key${ki+1} error: ${e.message}`);
        continue;
      }
    }
  }

  return res.status(500).json({ ok: false, error: 'all attempts failed' });
}

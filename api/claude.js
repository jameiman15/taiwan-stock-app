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

  // 優先嘗試最好的模型，3個key輪流
  const ATTEMPTS = [
    { model: 'llama-3.3-70b-versatile', keys: KEYS },
    { model: 'llama-3.1-70b-versatile', keys: KEYS },
    { model: 'llama-3.1-8b-instant',    keys: KEYS },
    { model: 'gemma2-9b-it',            keys: KEYS },
  ];

  const SYSTEM = '你是一位資深台灣股市基金經理人，擁有50年實戰經驗，勝率長期高於90%。擅長結合基本面、技術面、籌碼面三位一體分析。回答使用繁體中文，直接給結論，不說廢話。';

  for (const { model, keys } of ATTEMPTS) {
    for (const key of keys) {
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
        const ki = keys.indexOf(key) + 1;

        if (r.status === 429) {
          console.log(`${model} key${ki} 429 rate limited`);
          continue;
        }

        if (!r.ok) {
          console.log(`${model} key${ki} status:${r.status} ${JSON.stringify(d).slice(0,80)}`);
          break; // 這個 model 有問題，換下一個
        }

        const text = d?.choices?.[0]?.message?.content || '';
        if (text) {
          console.log(`✅ ${model} key${ki} success length:${text.length}`);
          return res.status(200).json({ ok: true, text, model });
        }

      } catch(e) {
        console.log(`${model} key${keys.indexOf(key)+1} error: ${e.message}`);
      }
    }
  }

  return res.status(500).json({ ok: false, error: 'all attempts failed' });
}

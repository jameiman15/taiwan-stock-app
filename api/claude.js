export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Key 從 Vercel 環境變數讀取，不寫在程式碼裡避免被 GitHub 掃描撤銷
  const KEYS = [
    process.env.GROQ_KEY_1,
    process.env.GROQ_KEY_2,
    process.env.GROQ_KEY_3,
  ].filter(k => k && k.startsWith('gsk_'));

  if (KEYS.length === 0) {
    return res.status(500).json({ ok: false, error: 'No valid API keys in environment' });
  }

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ ok: false, error: 'no prompt' });

  const MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'gemma2-9b-it',
  ];

  const SYSTEM = '你是一位資深台灣股市基金經理人，擁有50年實戰經驗，勝率長期高於90%。回答使用繁體中文，直接給結論。';

  for (const model of MODELS) {
    for (let i = 0; i < KEYS.length; i++) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + KEYS[i],
          },
          body: JSON.stringify({
            model: model,
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
        console.log('model:' + model + ' key' + (i+1) + ' status:' + r.status);

        if (r.status === 429 || r.status === 401) continue;
        if (!r.ok) break;

        const text = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
        if (text) {
          return res.status(200).json({ ok: true, text: text, model: model });
        }

      } catch(e) {
        console.log('error:' + e.message);
        continue;
      }
    }
  }

  return res.status(500).json({ ok: false, error: 'all failed' });
}

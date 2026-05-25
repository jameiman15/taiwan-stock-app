export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const GROQ_KEY = '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';
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ ok: false, error: 'no prompt' });

  // 嘗試多個 model，某個被限速就換下一個
  const MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-70b-versatile',
    'llama3-70b-8192',
    'mixtral-8x7b-32768',
  ];

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
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
                content: '你是一位資深台灣股市基金經理人，勝率長期高於90%。擅長結合基本面、技術面、籌碼面三位一體分析。回答使用繁體中文，直接給結論，不說廢話。'
              },
              { role: 'user', content: prompt }
            ],
            max_tokens: 1500,
            temperature: 0.6,
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (r.status === 429) {
          const errBody = await r.json().catch(()=>({}));
          console.log(`${model} rate limited:`, JSON.stringify(errBody).slice(0,100));
          // 等一秒再換下一個 model
          await new Promise(r => setTimeout(r, 1000));
          break;
        }

        const d = await r.json();
        console.log(`${model} status:${r.status}`);

        const text = d?.choices?.[0]?.message?.content || '';
        if (text) return res.status(200).json({ ok: true, text, model });

      } catch(e) {
        console.log(`${model} attempt ${attempt} error:`, e.message);
        if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  return res.status(500).json({ ok: false, error: 'all models failed' });
}

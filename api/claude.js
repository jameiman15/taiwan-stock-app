export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const GROQ_KEY = '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';
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ ok: false, error: 'no prompt' });

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1200,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(20000),
    });

    const d = await r.json();
    console.log('Groq status:', r.status, JSON.stringify(d).slice(0, 200));

    const text = d?.choices?.[0]?.message?.content || '';
    if (text) return res.status(200).json({ ok: true, text, model: 'groq-llama3.3' });

    return res.status(500).json({ ok: false, error: 'empty response', raw: d });
  } catch(e) {
    console.log('Groq error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

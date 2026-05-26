export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const k1 = process.env.GROQ_KEY_1 || '';
  const k2 = process.env.GROQ_KEY_2 || '';
  const k3 = process.env.GROQ_KEY_3 || '';

  const mask = s => s ? s.slice(0, 12) + '...(len:' + s.length + ')' : '(empty)';

  const info = {
    GROQ_KEY_1: mask(k1),
    GROQ_KEY_2: mask(k2),
    GROQ_KEY_3: mask(k3),
    valid_keys: [k1, k2, k3].filter(k => k && k.startsWith('gsk_')).length,
    node_env: process.env.NODE_ENV || '(not set)',
    vercel_env: process.env.VERCEL_ENV || '(not set)',
  };

  const validKeys = [k1, k2, k3].filter(k => k && k.startsWith('gsk_'));
  if (validKeys.length > 0) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + validKeys[0],
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: 'say ok' }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(10000),
      });
      info.groq_test_status = r.status;
      info.groq_test_ok = r.ok;
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        info.groq_error = errBody?.error?.message || 'unknown';
      }
    } catch(e) {
      info.groq_test_status = 'fetch_error';
      info.groq_error = e.message;
    }
  } else {
    info.groq_test_status = 'skipped_no_valid_keys';
  }

  return res.status(200).json(info);
}

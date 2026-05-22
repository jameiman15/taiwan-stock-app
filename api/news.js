// api/news.js — 即時新聞 proxy（解決前端 CORS 問題）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');

  // 先嘗試抓 RSS
  const RSS = [
    { url: 'https://www.cnyes.com/rss/cat/tw_stock', src: '🇹🇼 鉅亨網', tag: '台股' },
    { url: 'https://www.cnyes.com/rss/cat/us_stock',  src: '🇺🇸 鉅亨網', tag: '美股' },
    { url: 'https://www.cnyes.com/rss/cat/etf',       src: '🇹🇼 鉅亨網', tag: 'ETF'  },
    { url: 'https://moneydj.com/rss/news.aspx?c=mb010000', src: '🇹🇼 MoneyDJ', tag: '台股' },
  ];

  const news = [];
  await Promise.allSettled(
    RSS.map(async (s) => {
      try {
        const r = await fetch(s.url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return;
        const xml = await r.text();
        // 簡單解析 XML item
        const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 4);
        items.forEach(m => {
          const titleMatch = m[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
          const dateMatch  = m[1].match(/<pubDate>(.*?)<\/pubDate>/);
          const title = (titleMatch?.[1] || titleMatch?.[2] || '').trim();
          if (!title) return;
          // 嘗試多種 XML link 格式
          let url = '';
          const linkMatch1 = m[1].match(/<link>([^<]+)<\/link>/);
          const linkMatch2 = m[1].match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/);
          const linkMatch3 = m[1].match(/<guid[^>]*>([^<]+)<\/guid>/);
          url = (linkMatch2?.[1] || linkMatch1?.[1] || linkMatch3?.[1] || '').trim();
          // 確保是有效 URL
          if (!url.startsWith('http')) url = '';
          const d = dateMatch ? new Date(dateMatch[1]) : new Date();
          const diff = Math.round((Date.now() - d.getTime()) / 60000);
          const time = diff < 60 ? diff + '分鐘前' : Math.round(diff/60) + '小時前';
          news.push({ src: s.src, tag: s.tag, title, time, url: url || null });
        });
      } catch(e) {}
    })
  );

  // 有新聞直接回傳
  if (news.length >= 5) {
    return res.status(200).json({ ok: true, news });
  }

  // RSS 失敗則用 Groq 生成
  try {
    const GROQ_KEY = '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';
    const today = new Date().toLocaleDateString('zh-TW');
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: `今天是 ${today}，請列出 8 則台灣股市與美股的重要新聞，只回 JSON 陣列，格式：[{"src":"來源","tag":"台股或美股或ETF或外資","title":"繁體中文標題","time":"大約時間"}]` }],
        max_tokens: 800, temperature: 0.5,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    const text = d?.choices?.[0]?.message?.content || '[]';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json({ ok: true, news: parsed, source: 'groq' });
  } catch(e) {
    return res.status(200).json({ ok: false, news: [] });
  }
}

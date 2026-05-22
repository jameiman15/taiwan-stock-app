// api/news.js — 即時新聞 proxy（解決前端 CORS 問題）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');

  const GEMINI_KEY = 'AIzaSyCsz7qZrwRItKyAs7iB6wkK5cUD3xGZhnI';

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
          const d = dateMatch ? new Date(dateMatch[1]) : new Date();
          const diff = Math.round((Date.now() - d.getTime()) / 60000);
          const time = diff < 60 ? diff + '分鐘前' : Math.round(diff/60) + '小時前';
          news.push({ src: s.src, tag: s.tag, title, time });
        });
      } catch(e) {}
    })
  );

  // 有新聞直接回傳
  if (news.length >= 5) {
    return res.status(200).json({ ok: true, news });
  }

  // RSS 失敗則用 Gemini 生成
  try {
    const today = new Date().toLocaleDateString('zh-TW');
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `今天是 ${today}，請根據你最新的知識，列出 8 則台灣股市與美股的重要新聞或市場動態，用 JSON 陣列格式回覆（只回 JSON，不要 markdown 或其他文字）：
[{"src":"來源","tag":"台股或美股或ETF或外資","title":"新聞標題（繁體中文）","time":"大約時間"}]
來源可以是鉅亨網、工商時報、經濟日報、MoneyDJ、Reuters、Bloomberg等。` }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 800 },
        }),
      }
    );
    const d = await r.json();
    const text = d?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json({ ok: true, news: parsed, source: 'gemini' });
  } catch(e) {
    return res.status(200).json({ ok: false, news: [] });
  }
}

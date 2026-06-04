// api/news.js — 即時財經新聞（Google News RSS）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
  const news = [];

  function parseRSS(xml, src, tag) {
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 4);
    items.forEach(m => {
      const titleM = m[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
      const dateM  = m[1].match(/<pubDate>(.*?)<\/pubDate>/);
      const linkM  = m[1].match(/<link>([^<\s]+)<\/link>/) ||
                     m[1].match(/<guid isPermaLink="true">([^<]+)<\/guid>/) ||
                     m[1].match(/<guid[^>]*>([^<]+)<\/guid>/);
      const title  = (titleM?.[1] || titleM?.[2] || '')
        .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").trim();
      if (!title || title.length < 5) return;
      const d    = dateM ? new Date(dateM[1]) : new Date();
      const ts   = Math.round(d.getTime() / 1000);
      const diff = Math.round((Date.now() - d.getTime()) / 60000);
      const time = diff < 1 ? '剛剛' : diff < 60 ? diff+'分鐘前' : diff < 1440 ? Math.round(diff/60)+'小時前' : Math.round(diff/1440)+'天前';
      const link = (linkM?.[1] || '').trim();
      news.push({ src, tag, title, time, url: link.startsWith('http') ? link : null, ts });
    });
  }

  // ── Google News RSS（最穩定，Vercel 可存取）──────────────────────
  const GOOGLE_QUERIES = [
    { q: '台積電',              hl: 'zh-TW', gl: 'TW', tag: '台股', src: '🇹🇼 Google新聞' },
    { q: '台股 半導體',          hl: 'zh-TW', gl: 'TW', tag: '台股', src: '🇹🇼 Google新聞' },
    { q: '聯發科 OR 鴻海 OR 廣達', hl: 'zh-TW', gl: 'TW', tag: '台股', src: '🇹🇼 Google新聞' },
    { q: 'NVIDIA AI chip',      hl: 'en-US', gl: 'US', tag: '美股', src: '🇺🇸 Google News' },
    { q: 'Taiwan stock TSMC',   hl: 'en-US', gl: 'US', tag: '台股', src: '🌐 Google News' },
    { q: 'semiconductor market',hl: 'en-US', gl: 'US', tag: '科技', src: '🌐 Google News' },
    { q: 'S&P500 OR Nasdaq',    hl: 'en-US', gl: 'US', tag: '美股', src: '🇺🇸 Google News' },
  ];

  await Promise.allSettled(GOOGLE_QUERIES.map(async ({ q, hl, gl, tag, src }) => {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${gl}:${hl.split('-')[0]}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) return;
      const xml = await r.text();
      parseRSS(xml, src, tag);
    } catch(e) {}
  }));

  // ── Yahoo Finance Search API（備援）─────────────────────────────
  if (news.length < 5) {
    const YF_QUERIES = [
      { q: 'TSMC Taiwan semiconductor', tag: '台股', src: '🌐 Yahoo Finance' },
      { q: 'NVIDIA AI earnings',         tag: '美股', src: '🇺🇸 Yahoo Finance' },
      { q: 'Taiwan stock market',        tag: '台股', src: '🌐 Yahoo Finance' },
    ];
    await Promise.allSettled(YF_QUERIES.map(async ({ q, tag, src }) => {
      try {
        const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=3&quotesCount=0`;
        const r = await fetch(url, {
          headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' },
          signal: AbortSignal.timeout(7000)
        });
        if (!r.ok) return;
        const d = await r.json();
        (d?.news || []).slice(0, 3).forEach(item => {
          if (!item.title) return;
          const diff = Math.round((Date.now() - (item.providerPublishTime || 0) * 1000) / 60000);
          const time = diff < 1 ? '剛剛' : diff < 60 ? diff+'分鐘前' : diff < 1440 ? Math.round(diff/60)+'小時前' : Math.round(diff/1440)+'天前';
          news.push({ src: item.publisher ? `🌐 ${item.publisher}` : src, tag, title: item.title, time, url: item.link || null, ts: item.providerPublishTime || 0 });
        });
      } catch(e) {}
    }));
  }

  // ── 去重 + 排序 ───────────────────────────────────────────────────
  const seen = new Set();
  const result = news
    .filter(n => {
      const k = n.title.slice(0, 30);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    })
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 15);

  if (result.length >= 3) {
    return res.status(200).json({ ok: true, news: result });
  }

  // ── 最後 fallback：直接回傳空，前端顯示錯誤訊息 ─────────────────
  return res.status(200).json({ ok: false, news: [] });
}

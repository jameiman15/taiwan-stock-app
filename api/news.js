// api/news.js — 即時財經新聞（多源抓取）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const news = [];

  // ── 1. Yahoo Finance Search API（最穩定）────────────────────────
  const YF_QUERIES = [
    { q: '台積電 台股',        tag: '台股', src: '🇹🇼 Yahoo財經' },
    { q: '聯發科 半導體',       tag: '台股', src: '🇹🇼 Yahoo財經' },
    { q: 'NVIDIA AI chip',     tag: '美股', src: '🇺🇸 Yahoo Finance' },
    { q: 'Taiwan stock market', tag: '台股', src: '🌐 Yahoo Finance' },
    { q: 'semiconductor AI',   tag: '科技', src: '🌐 Yahoo Finance' },
  ];

  await Promise.allSettled(YF_QUERIES.map(async ({ q, tag, src }) => {
    try {
      const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=3&quotesCount=0&enableFuzzyQuery=false&lang=zh-TW`;
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' },
        signal: AbortSignal.timeout(7000)
      });
      if (!r.ok) return;
      const d = await r.json();
      (d?.news || []).slice(0, 3).forEach(item => {
        if (!item.title) return;
        const diff = Math.round((Date.now() - (item.providerPublishTime || 0) * 1000) / 60000);
        const time = diff < 1 ? '剛剛' : diff < 60 ? diff + '分鐘前' : diff < 1440 ? Math.round(diff/60) + '小時前' : Math.round(diff/1440) + '天前';
        news.push({
          src: item.publisher ? `🌐 ${item.publisher}` : src,
          tag,
          title: item.title,
          time,
          url: item.link || null,
          ts: item.providerPublishTime || 0
        });
      });
    } catch(e) {}
  }));

  // ── 2. Yahoo Finance RSS per symbol ──────────────────────────────
  const RSS_SYMS = [
    { sym: 'TSM',     tag: '台股', src: '🌐 Yahoo Finance' },
    { sym: 'NVDA',    tag: '美股', src: '🌐 Yahoo Finance' },
    { sym: 'AMD',     tag: '美股', src: '🌐 Yahoo Finance' },
    { sym: 'AVGO',    tag: '美股', src: '🌐 Yahoo Finance' },
    { sym: '2330.TW', tag: '台股', src: '🇹🇼 Yahoo財經' },
    { sym: '2454.TW', tag: '台股', src: '🇹🇼 Yahoo財經' },
  ];

  await Promise.allSettled(RSS_SYMS.map(async ({ sym, tag, src }) => {
    try {
      const r = await fetch(`https://finance.yahoo.com/rss/headline?s=${encodeURIComponent(sym)}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(6000)
      });
      if (!r.ok) return;
      const xml = await r.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 2);
      items.forEach(m => {
        const titleM = m[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
        const dateM  = m[1].match(/<pubDate>(.*?)<\/pubDate>/);
        const linkM  = m[1].match(/<link>([^<\s]+)<\/link>/) || m[1].match(/<guid[^>]*>([^<]+)<\/guid>/);
        const title  = (titleM?.[1] || titleM?.[2] || '').trim();
        if (!title || title === sym) return;
        const d    = dateM ? new Date(dateM[1]) : new Date();
        const ts   = Math.round(d.getTime() / 1000);
        const diff = Math.round((Date.now() - d.getTime()) / 60000);
        const time = diff < 1 ? '剛剛' : diff < 60 ? diff + '分鐘前' : diff < 1440 ? Math.round(diff/60) + '小時前' : Math.round(diff/1440) + '天前';
        const link = (linkM?.[1] || '').trim();
        news.push({ src, tag, title, time, url: link.startsWith('http') ? link : null, ts });
      });
    } catch(e) {}
  }));

  // ── 3. Reuters / MarketWatch RSS（英文財經）──────────────────────
  const INTL_RSS = [
    { url: 'https://feeds.reuters.com/reuters/businessNews', src: '🌐 Reuters', tag: '國際' },
    { url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', src: '🌐 MarketWatch', tag: '美股' },
    { url: 'https://www.ft.com/technology?format=rss', src: '🌐 FT', tag: '科技' },
  ];

  await Promise.allSettled(INTL_RSS.map(async ({ url, src, tag }) => {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(6000)
      });
      if (!r.ok) return;
      const xml = await r.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 3);
      items.forEach(m => {
        const titleM = m[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
        const dateM  = m[1].match(/<pubDate>(.*?)<\/pubDate>/);
        const linkM  = m[1].match(/<link>([^<\s]+)<\/link>/) || m[1].match(/<guid[^>]*isPermaLink="true">([^<]+)<\/guid>/);
        const title  = (titleM?.[1] || titleM?.[2] || '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
        if (!title) return;
        // 只保留跟 AI/半導體/台股相關的
        const relevant = /nvidia|tsmc|taiwan|semiconductor|ai|chip|tech|股|晶片|半導體/i.test(title);
        if (!relevant) return;
        const d    = dateM ? new Date(dateM[1]) : new Date();
        const ts   = Math.round(d.getTime() / 1000);
        const diff = Math.round((Date.now() - d.getTime()) / 60000);
        const time = diff < 1 ? '剛剛' : diff < 60 ? diff + '分鐘前' : diff < 1440 ? Math.round(diff/60) + '小時前' : Math.round(diff/1440) + '天前';
        const link = (linkM?.[1] || '').trim();
        news.push({ src, tag, title, time, url: link.startsWith('http') ? link : null, ts });
      });
    } catch(e) {}
  }));

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

  // ── Groq fallback（網路全掛時才用）── 明確標記非即時 ─────────────
  try {
    const KEYS = [process.env.GROQ_KEY_1, process.env.GROQ_KEY_2, process.env.GROQ_KEY_3]
      .filter(k => k?.startsWith('gsk_'));
    if (!KEYS.length) throw new Error('no keys');

    const today = new Date().toLocaleDateString('zh-TW');
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEYS[0]}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: `今天是${today}，請根據訓練知識列出8則台股與美股財經新聞標題（注意：這是AI根據訓練資料生成，非即時新聞）。只回JSON，格式：[{"src":"來源","tag":"台股或美股","title":"繁體中文標題","time":"非即時","url":null,"aiGenerated":true}]` }],
        max_tokens: 600, temperature: 0.3,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const d = await r.json();
    const text = d?.choices?.[0]?.message?.content || '[]';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return res.status(200).json({ ok: true, news: parsed.map(n => ({...n, src:'🤖 AI彙整', aiGenerated:true})), source: 'groq' });
  } catch(e) {
    return res.status(200).json({ ok: false, news: [] });
  }
}

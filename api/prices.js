// api/prices.js — Vercel Serverless Function
// 使用 Fugle API（台灣證交所官方即時資料）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const FUGLE_KEY = 'YTU1NzQ0ZjgtOGNlMy00MjlhLWE0ZTItMDgwYWIyMjM0YmE0IGQzMDkwNTE2LTZjZjMtNGY4My1hNmYzLTdhZDliYmU1Yjg0Zg==';
  const FUGLE_API = 'https://api.fugle.tw/marketdata/v1.0';
  const results = {};

  // 台股個股代碼列表
  const TW_STOCKS = [
    '2330', '2317', '2454', '00878', '0050',
    '2412', '2882', '00929', '2884', '2379', '2303',
    '6505', '3008'
  ];

  // ── 1. Fugle 台股個股即時報價────────────────────────────────────
  await Promise.allSettled(
    TW_STOCKS.map(async (code) => {
      try {
        const r = await fetch(
          `${FUGLE_API}/intraday/quote/${code}`,
          { headers: { 'X-API-KEY': FUGLE_KEY } }
        );
        if (!r.ok) return;
        const d = await r.json();
        const quote = d?.data?.quote;
        if (quote && quote.price) {
          const price = quote.price;
          const change = quote.change ?? 0;
          const changePercent = quote.changePercent ?? 0;
          const name = d?.data?.name || code;
          results[code] = { price, change: +change.toFixed(2), changePct: +changePercent.toFixed(2), name, source: 'Fugle', ok: true };
        }
      } catch(e) {}
    })
  );

  // ── 2. Fugle 加權指數────────────────────────────────────────────
  try {
    const r = await fetch(
      `${FUGLE_API}/intraday/quote/TAIEX`,
      { headers: { 'X-API-KEY': FUGLE_KEY } }
    );
    if (r.ok) {
      const d = await r.json();
      const quote = d?.data?.quote;
      if (quote && quote.price) {
        results['TAIEX'] = {
          price: quote.price,
          change: +(quote.change ?? 0).toFixed(2),
          changePct: +(quote.changePercent ?? 0).toFixed(2),
          name: '加權指數',
          source: 'Fugle',
          ok: true
        };
      }
    }
  } catch(e) {}

  // ── 3. 台指期夜盤────────────────────────────────────────────────
  try {
    const r = await fetch(
      `${FUGLE_API}/intraday/quote/TXF`,
      { headers: { 'X-API-KEY': FUGLE_KEY } }
    );
    if (r.ok) {
      const d = await r.json();
      const quote = d?.data?.quote;
      if (quote && quote.price) {
        results['TW=F'] = {
          price: quote.price,
          change: +(quote.change ?? 0).toFixed(2),
          changePct: +(quote.changePercent ?? 0).toFixed(2),
          name: '台指期夜盤',
          source: 'Fugle',
          ok: true
        };
      }
    }
  } catch(e) {}

  // ── 4. 美股指數 via Yahoo Finance v8/chart（作為備用）──────────
  // 美股用簡單的直接 fetch，不依賴 header
  const US_SYMBOLS = {
    '^IXIC': '那斯達克',
    '^GSPC': 'S&P500',
    '^SOX': '費城半導體',
    'TSM': '台積電ADR',
  };

  await Promise.allSettled(
    Object.entries(US_SYMBOLS).map(async ([sym, name]) => {
      try {
        // 嘗試 query1 和 query2，某個可能可用
        let r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`,
          { signal: AbortSignal.timeout(5000) }
        ).catch(() => null);
        
        if (!r?.ok) {
          r = await fetch(
            `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`,
            { signal: AbortSignal.timeout(5000) }
          ).catch(() => null);
        }
        
        if (!r?.ok) return;
        
        const d = await r.json();
        const result = d?.chart?.result?.[0];
        if (!result) return;
        const meta = result.meta;
        const closes = (result.indicators?.quote?.[0]?.close || []).filter(c => c != null && c > 0);
        const price = meta.regularMarketPrice ?? closes[closes.length - 1];
        const prevClose = closes.length >= 2 ? closes[closes.length - 2] : (meta.chartPreviousClose ?? meta.previousClose ?? price);
        const change = price && prevClose ? +(price - prevClose).toFixed(2) : 0;
        const changePct = prevClose && prevClose > 0 ? +((change / prevClose) * 100).toFixed(2) : 0;
        
        if (price && price > 0) {
          results[sym] = { price, change, changePct, name, source: 'Yahoo', ok: true };
        }
      } catch(e) {}
    })
  );

  const hasData = Object.keys(results).length > 0;
  return res.status(200).json({
    ok: hasData,
    data: results,
    count: Object.keys(results).length,
    updatedAt: new Date().toISOString()
  });
}

// api/prices.js — Vercel Serverless Function
// 台股用 Fugle API，美股用 Yahoo Finance
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const FUGLE_KEY = 'YTU1NzQ0ZjgtOGNlMy00MjlhLWE0ZTItMDgwYWIyMjM0YmE0IGQzMDkwNTE2LTZjZjMtNGY4My1hNmYzLTdhZDliYmU1Yjg0Zg==';
  const FUGLE = 'https://api.fugle.tw/marketdata/v1.0/stock';
  const results = {};

  // ── 1. 台股個股 + 加權指數 via Fugle ─────────────────────────────
  // Response 格式（根層）: { symbol, name, closePrice, change, changePercent, lastPrice, ... }
  const TW_CODES = [
    '2330','2317','2454','00878','0050',
    '2412','2882','00929','2884',
    '2379','2303','6505','3008',
    'TAIEX', // 加權指數
  ];

  await Promise.allSettled(
    TW_CODES.map(async (code) => {
      try {
        const r = await fetch(
          `${FUGLE}/intraday/quote/${code}`,
          { headers: { 'X-API-KEY': FUGLE_KEY }, signal: AbortSignal.timeout(8000) }
        );
        if (!r.ok) return;
        const d = await r.json();
        // Fugle 盤中回傳 lastPrice，盤後回傳 closePrice
        const price = d.lastPrice ?? d.closePrice ?? d.previousClose;
        if (!price || price <= 0) return;
        const change    = d.change ?? 0;
        const changePct = d.changePercent ?? 0;
        const name      = d.name || code;
        const storeKey  = code === 'TAIEX' ? 'TAIEX' : code;
        results[storeKey] = { price, change: +change.toFixed(2), changePct: +changePct.toFixed(2), name, source: 'Fugle', ok: true };
      } catch(e) {}
    })
  );

  // ── 2. 台指期夜盤 via Fugle ───────────────────────────────────────
  try {
    const r = await fetch(
      `${FUGLE}/intraday/quote/TXF`,
      { headers: { 'X-API-KEY': FUGLE_KEY }, signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) {
      const d = await r.json();
      const price = d.lastPrice ?? d.closePrice;
      if (price && price > 0) {
        results['TW=F'] = {
          price,
          change: +(d.change ?? 0).toFixed(2),
          changePct: +(d.changePercent ?? 0).toFixed(2),
          name: '台指期夜盤',
          source: 'Fugle',
          ok: true
        };
      }
    }
  } catch(e) {}

  // ── 3. 美股指數 + 台積電ADR via Yahoo Finance ─────────────────────
  const US_SYMBOLS = {
    '^IXIC': '那斯達克',
    '^GSPC': 'S&P500',
    '^SOX' : '費城半導體',
    'TSM'  : '台積電ADR',
  };

  await Promise.allSettled(
    Object.entries(US_SYMBOLS).map(async ([sym, name]) => {
      try {
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
        const meta    = result.meta;
        const closes  = (result.indicators?.quote?.[0]?.close || []).filter(c => c != null && c > 0);
        const price   = meta.regularMarketPrice ?? closes[closes.length - 1];
        const prev    = closes.length >= 2 ? closes[closes.length - 2] : (meta.chartPreviousClose ?? meta.previousClose ?? price);
        const change    = price && prev ? +(price - prev).toFixed(2) : 0;
        const changePct = prev && prev > 0 ? +((change / prev) * 100).toFixed(2) : 0;
        if (price && price > 0) {
          results[sym] = { price, change, changePct, name, source: 'Yahoo', ok: true };
        }
      } catch(e) {}
    })
  );

  return res.status(200).json({
    ok: Object.keys(results).length > 0,
    data: results,
    count: Object.keys(results).length,
    updatedAt: new Date().toISOString()
  });
}

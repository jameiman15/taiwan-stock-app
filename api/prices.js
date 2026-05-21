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
  // 個股代碼
  const TW_CODES = [
    '2330','2317','2454','00878','0050',
    '2412','2882','00929','2884',
    '2379','2303','6505','3008',
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
        const price = d.lastPrice ?? d.closePrice ?? d.previousClose;
        if (!price || price <= 0) return;
        const change    = d.change ?? 0;
        const changePct = d.changePercent ?? 0;
        const name      = d.name || code;
        results[code] = { price, change: +change.toFixed(2), changePct: +changePct.toFixed(2), name, source: 'Fugle', ok: true };
      } catch(e) {}
    })
  );

  // ── 2. 加權指數 via Fugle（代碼 IX0001）──────────────────────────
  try {
    const r = await fetch(
      `${FUGLE}/intraday/quote/IX0001`,
      { headers: { 'X-API-KEY': FUGLE_KEY }, signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) {
      const d = await r.json();
      const price = d.lastPrice ?? d.closePrice ?? d.previousClose;
      if (price && price > 0) {
        results['TAIEX'] = {
          price,
          change: +(d.change ?? 0).toFixed(2),
          changePct: +(d.changePercent ?? 0).toFixed(2),
          name: '加權指數',
          source: 'Fugle',
          ok: true
        };
      }
    }
  } catch(e) {}

  // ── 3. 台指期近月 via Fugle futopt endpoint ───────────────────────
  // 台指期夜盤 15:45 開盤，若未開盤則顯示昨日收盤價
  try {
    const r = await fetch(
      'https://api.fugle.tw/marketdata/v1.0/futopt/intraday/quote/TXFC5',
      { headers: { 'X-API-KEY': FUGLE_KEY }, signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) {
      const d = await r.json();
      // lastPrice 有值且有成交量 → 夜盤已開盤
      const isOpen = d.lastPrice && d.total?.tradeVolume > 0;
      const price  = isOpen ? d.lastPrice : (d.closePrice ?? d.previousClose);
      if (price && price > 0) {
        results['TW=F'] = {
          price,
          change:    +(d.change ?? 0).toFixed(2),
          changePct: +(d.changePercent ?? 0).toFixed(2),
          name:      '台指期',
          isYesterday: !isOpen,   // 前端用來顯示「昨」標籤
          source:    'Fugle',
          ok:        true
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

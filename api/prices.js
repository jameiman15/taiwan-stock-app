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
  // 動態代碼：前端傳入 ?codes=2330,0050,... 或使用預設清單
  const defaultCodes = ['2330','2317','2454','00878','0050','2412','2882','00929','2884','2379','2303','6505','3008'];
  const queryCodesParam = req.query?.codes || '';
  const extraCodes = queryCodesParam ? queryCodesParam.split(',').map(c=>c.trim().toUpperCase()).filter(Boolean) : [];
  // 合併去重
  const TW_CODES = [...new Set([...defaultCodes, ...extraCodes])];

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

  // ── 3. 台指期 via Yahoo Finance（Fugle 期貨需付費，改用 Yahoo）──
  try {
    const txfUrl = `https://query2.finance.yahoo.com/v8/finance/chart/TW%3DF?interval=1d&range=5d`;
    const txfUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const txfR = await fetch(txfUrl, {
      headers: { 'User-Agent': txfUA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' },
      signal: AbortSignal.timeout(8000),
    });
    if (txfR.ok) {
      const txfD = await txfR.json();
      const result = txfD?.chart?.result?.[0];
      if (result) {
        const meta   = result.meta;
        const closes = (result.indicators?.quote?.[0]?.close || []).filter(c => c != null && c > 0);
        const price  = meta.regularMarketPrice ?? closes[closes.length - 1];
        const prev   = closes.length >= 2 ? closes[closes.length - 2] : (meta.chartPreviousClose ?? price);
        const change    = price && prev ? +(price - prev).toFixed(0) : 0;
        const changePct = prev && prev > 0 ? +((change / prev) * 100).toFixed(2) : 0;
        if (price && price > 0) {
          // 判斷是否在交易時段（台指期夜盤 15:00-05:00，日盤 08:45-13:45）
          const hour = new Date().getUTCHours() + 8; // 台灣時間
          const isOpen = (hour >= 15) || (hour < 5) || (hour >= 8 && hour < 14);
          results['TW=F'] = {
            price, change, changePct,
            name: '台指期',
            isYesterday: !isOpen,
            source: 'Yahoo',
            ok: true
          };
        }
      }
    }
  } catch(e) { console.log('TXF Yahoo error:', e.message); }

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

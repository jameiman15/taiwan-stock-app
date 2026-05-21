// api/prices.js — Vercel Serverless Function
// 這個 function 在 Vercel 伺服器端執行，不受 CORS 限制
// 串接 TWSE 官方 OpenAPI + Yahoo Finance

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const results = {};

    // ── 1. 台股全股收盤價 (TWSE OpenAPI，免費無需 key) ──────────────
    const [twseRes, tpexRes, indexRes] = await Promise.allSettled([
      fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }),
      fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }),
      fetch('https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }),
    ]);

    // 處理上市個股 (TWSE)
    if (twseRes.status === 'fulfilled' && twseRes.value.ok) {
      const data = await twseRes.value.json();
      if (Array.isArray(data)) {
        data.forEach(item => {
          const code = item.Code?.trim();
          const price = parseFloat(item.ClosingPrice?.replace(/,/g, ''));
          const avg   = parseFloat(item.MonthlyAveragePrice?.replace(/,/g, ''));
          if (code && !isNaN(price)) {
            const change = !isNaN(avg) ? +(price - avg).toFixed(2) : 0;
            const changePct = !isNaN(avg) && avg !== 0 ? +((price - avg) / avg * 100).toFixed(2) : 0;
            results[code] = { price, change, changePct, name: item.Name, source: 'TWSE', ok: true };
          }
        });
      }
    }

    // 處理上櫃個股 (TPEx)
    if (tpexRes.status === 'fulfilled' && tpexRes.value.ok) {
      const data = await tpexRes.value.json();
      if (Array.isArray(data)) {
        data.forEach(item => {
          const code  = item.SecuritiesCompanyCode?.trim();
          const price = parseFloat(item.Close?.replace(/,/g, ''));
          const prev  = parseFloat(item.Yesterday?.replace(/,/g, ''));
          if (code && !isNaN(price) && !results[code]) {
            const change    = !isNaN(prev) ? +(price - prev).toFixed(2) : 0;
            const changePct = !isNaN(prev) && prev !== 0 ? +((price - prev) / prev * 100).toFixed(2) : 0;
            results[code] = { price, change, changePct, name: item.CompanyName, source: 'TPEx', ok: true };
          }
        });
      }
    }

    // ── 2. 加權指數 ────────────────────────────────────────────────
if (indexRes.status === 'fulfilled' && indexRes.value.ok) {
      try {
        const data = await indexRes.value.json();
        // 嘗試多種可能的欄位名稱
        const rows = data?.data9 || data?.data8 || data?.data || [];
        const taiex = rows.find(r => Array.isArray(r) && r[0] && (r[0].includes('加權') || r[0].includes('發行量')));
        if (taiex) {
          const price = parseFloat((taiex[1] || taiex[2] || '').replace(/,/g, ''));
          const change = parseFloat((taiex[2] || '0').replace(/,/g, ''));
          if (!isNaN(price) && price > 0) {
            const changePct = price > 0 ? +((change / (price - change)) * 100).toFixed(2) : 0;
            results['TAIEX'] = { price, change, changePct, name: '加權指數', source: 'TWSE', ok: true };
          }
        }
        // 如果上面找不到，直接抓另一個 API
        if (!results['TAIEX']) {
          const r2 = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          if (r2.ok) {
            const d2 = await r2.json();
            if (Array.isArray(d2) && d2[0]) {
              const price = parseFloat((d2[0].TAIEX || '').replace(/,/g, ''));
              if (!isNaN(price) && price > 0) {
                results['TAIEX'] = { price, change: 0, changePct: 0, name: '加權指數', source: 'TWSE', ok: true };
              }
            }
          }
        }
      } catch(e) {}
    }

    // ── 3. 美股指數 via Yahoo Finance (伺服器端無 CORS 問題) ────────
    const usSymbols = { '^DJI': '道瓊工業', '^IXIC': '那斯達克', '^GSPC': '標普500', 'TSM': '台積電ADR' };
    await Promise.allSettled(
      Object.entries(usSymbols).map(async ([sym, name]) => {
        try {
          const r = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`,
            { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockBot/1.0)' } }
          );
          if (!r.ok) return;
          const d = await r.json();
          const meta = d?.chart?.result?.[0]?.meta;
          if (!meta) return;
          const price  = meta.regularMarketPrice ?? meta.previousClose;
          const prev   = meta.previousClose ?? price;
          const change = +(price - prev).toFixed(2);
          const changePct = prev !== 0 ? +((change / prev) * 100).toFixed(2) : 0;
          results[sym] = { price, change, changePct, name, source: 'Yahoo', ok: true };
        } catch (e) {}
      })
    );

    return res.status(200).json({ ok: true, data: results, updatedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

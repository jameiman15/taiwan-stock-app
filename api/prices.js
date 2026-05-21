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
      fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL', {
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
      const data = await indexRes.value.json();
      // MI_INDEX 回傳結構：找加權指數那筆
      const fields = data?.fields9 || [];
      const rows   = data?.data9   || [];
      // 找「發行量加權股價指數」那列
      const taiex = rows.find(r => r?.[0]?.includes('加權'));
      if (taiex) {
        const price     = parseFloat(taiex[1]?.replace(/,/g, ''));
        const changePct = parseFloat(taiex[2]?.replace(/[%,]/g, ''));
        if (!isNaN(price)) {
          results['TAIEX'] = { price, change: 0, changePct: changePct || 0, name: '加權指數', source: 'TWSE', ok: true };
        }
      }
    }

    // ── 3. 美股指數 via Yahoo Finance (伺服器端無 CORS 問題) ────────
    // Yahoo 抓美股指數 + 台股個股（台積電等用 Yahoo 才有即時漲跌）
    const yahooSymbols = {
      '^IXIC': '那斯達克', '^GSPC': 'S&P500', '^SOX': '費城半導體',
      'TSM': '台積電ADR', 'TW=F': '台指期夜盤', '^TWII': '加權指數',
      '2330.TW': '台積電', '2317.TW': '鴻海', '2454.TW': '聯發科',
      '00878.TW': '國泰永續高股息', '0050.TW': '元大台灣50',
      '2412.TW': '中華電信', '2882.TW': '國泰金', '00929.TW': '復華台灣科技優息',
      '2884.TW': '玉山金', '2379.TW': '瑞昱', '2303.TW': '聯電',
      '6505.TW': '台塑化', '3008.TW': '大立光',
    };
    await Promise.allSettled(
      Object.entries(yahooSymbols).map(async ([sym, name]) => {
        try {
          const r = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`,
            { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockBot/1.0)' } }
          );
          if (!r.ok) return;
          const d = await r.json();
          const meta = d?.chart?.result?.[0]?.meta;
          if (!meta) return;
          const price = meta.regularMarketPrice ?? meta.previousClose;
          const change = meta.regularMarketChange != null
            ? +meta.regularMarketChange.toFixed(2)
            : 0;
          // Yahoo 的 regularMarketChangePercent 已經是百分比數值（如 4.49 代表 4.49%）
          const changePct = meta.regularMarketChangePercent != null
            ? +meta.regularMarketChangePercent.toFixed(2)
            : 0;
          // 台股個股去掉 .TW 後綴存 key，方便前端查詢
          const key = sym.endsWith('.TW') ? sym.replace('.TW', '') : sym;
          results[key] = { price, change, changePct, name, source: 'Yahoo', ok: true };
        } catch (e) {}
      })
    );
    // 加權指數同時存為 TAIEX key
    if (results['^TWII']) results['TAIEX'] = { ...results['^TWII'] };

    return res.status(200).json({ ok: true, data: results, updatedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// api/prices.js — Vercel Serverless Function
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const results = {};
    const YH = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    // ── 1. 台股個股 & ETF：TWSE STOCK_DAY_ALL（有真實漲跌欄位）────
    try {
      const r = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
        headers: { 'User-Agent': YH }
      });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data)) {
          data.forEach(item => {
            const code  = item.Code?.trim();
            const price = parseFloat((item.ClosingPrice || '').replace(/,/g, ''));
            // Change 欄位格式：+45.00 或 -10.00 或 0
            const rawChange = (item.Change || '').replace(/,/g, '').replace(/▲/g,'+').replace(/▼/g,'-').replace(/X/g,'0').trim();
            const change    = parseFloat(rawChange) || 0;
            const prev      = price - change;
            const changePct = prev !== 0 ? +((change / prev) * 100).toFixed(2) : 0;
            if (code && !isNaN(price) && price > 0) {
              results[code] = { price, change: +change.toFixed(2), changePct, name: item.Name, source: 'TWSE', ok: true };
            }
          });
        }
      }
    } catch(e) {}

    // ── 2. 上櫃個股 (TPEx) ──────────────────────────────────────────
    try {
      const r = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', {
        headers: { 'User-Agent': YH }
      });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data)) {
          data.forEach(item => {
            const code  = item.SecuritiesCompanyCode?.trim();
            const price = parseFloat((item.Close || '').replace(/,/g, ''));
            const prev  = parseFloat((item.Yesterday || '').replace(/,/g, ''));
            if (code && !isNaN(price) && price > 0 && !results[code]) {
              const change    = !isNaN(prev) ? +(price - prev).toFixed(2) : 0;
              const changePct = (!isNaN(prev) && prev > 0) ? +((price - prev) / prev * 100).toFixed(2) : 0;
              results[code] = { price, change, changePct, name: item.CompanyName, source: 'TPEx', ok: true };
            }
          });
        }
      }
    } catch(e) {}

    // ── 3. 美股指數 & ADR：Yahoo Finance v8/chart（逐一，最可靠）──
    const usSymbols = {
      '^IXIC': '那斯達克',
      '^GSPC': 'S&P500',
      '^SOX' : '費城半導體',
      'TSM'  : '台積電ADR',
      'TW=F' : '台指期夜盤',
      '^TWII': '加權指數',
    };

    await Promise.allSettled(
      Object.entries(usSymbols).map(async ([sym, name]) => {
        try {
          const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
          const r = await fetch(url, {
            headers: {
              'User-Agent': YH,
              'Accept': 'application/json',
              'Referer': 'https://finance.yahoo.com',
            }
          });
          if (!r.ok) return;
          const d = await r.json();
          const result = d?.chart?.result?.[0];
          if (!result) return;
          const meta   = result.meta;
          const closes = result.indicators?.quote?.[0]?.close || [];
          const price  = meta.regularMarketPrice ?? closes[closes.length - 1];
          // 用歷史收盤陣列的前一日來算漲跌（最準確）
          const validCloses = closes.filter(c => c != null);
          const prevClose   = validCloses.length >= 2
            ? validCloses[validCloses.length - 2]
            : (meta.chartPreviousClose ?? meta.previousClose ?? price);
          const change    = price != null && prevClose != null ? +(price - prevClose).toFixed(2) : 0;
          const changePct = prevClose && prevClose > 0 ? +((change / prevClose) * 100).toFixed(2) : 0;
          results[sym] = { price, change, changePct, name, source: 'Yahoo', ok: true };
        } catch(e) {}
      })
    );

    // 加權指數同時存為 TAIEX key
    if (results['^TWII']) results['TAIEX'] = { ...results['^TWII'] };

    return res.status(200).json({ ok: true, data: results, updatedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

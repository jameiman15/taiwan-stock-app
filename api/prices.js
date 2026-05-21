// api/prices.js — Vercel Serverless Function
// 台股 + 美股全部用 Yahoo Finance v8/chart（最即時，用歷史收盤算漲跌）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  const ALL_SYMBOLS = {
    // 美股指數
    '^IXIC' : '那斯達克',
    '^GSPC' : 'S&P500',
    '^SOX'  : '費城半導體',
    // 台股指數 & 期貨
    '^TWII' : '加權指數',
    'TW=F'  : '台指期夜盤',
    // 台積電ADR
    'TSM'   : '台積電ADR',
    // 台股個股（加 .TW）
    '2330.TW': '台積電',
    '2317.TW': '鴻海',
    '2454.TW': '聯發科',
    '00878.TW':'國泰永續高股息',
    '0050.TW' :'元大台灣50',
    '2412.TW' :'中華電信',
    '2882.TW' :'國泰金',
    '00929.TW':'復華台灣科技優息',
    '2884.TW' :'玉山金',
    '2379.TW' :'瑞昱',
    '2303.TW' :'聯電',
    '6505.TW' :'台塑化',
    '3008.TW' :'大立光',
  };

  const results = {};

  await Promise.allSettled(
    Object.entries(ALL_SYMBOLS).map(async ([sym, name]) => {
      try {
        const r = await fetch(
          `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`,
          {
            headers: {
              'User-Agent': UA,
              'Accept': 'application/json',
              'Referer': 'https://finance.yahoo.com',
              'Origin': 'https://finance.yahoo.com',
            }
          }
        );
        if (!r.ok) return;
        const d = await r.json();
        const result = d?.chart?.result?.[0];
        if (!result) return;

        const meta   = result.meta;
        const closes = (result.indicators?.quote?.[0]?.close || []).filter(c => c != null && c > 0);

        // 現價：優先用 regularMarketPrice（盤中即時），fallback 用最後收盤
        const price = meta.regularMarketPrice ?? closes[closes.length - 1];
        if (!price || price <= 0) return;

        // 昨收：用倒數第二筆歷史收盤（最準確），fallback 用 meta
        const prevClose = closes.length >= 2
          ? closes[closes.length - 2]
          : (meta.chartPreviousClose ?? meta.previousClose ?? price);

        const change    = +(price - prevClose).toFixed(2);
        const changePct = prevClose > 0 ? +((change / prevClose) * 100).toFixed(2) : 0;

        // 台股去掉 .TW 後綴存 key
        const key = sym.endsWith('.TW') ? sym.replace('.TW', '') : sym;
        results[key] = { price, change, changePct, name, source: 'Yahoo', ok: true };
      } catch(e) {}
    })
  );

  // 加權指數同時存為 TAIEX key
  if (results['^TWII']) results['TAIEX'] = { ...results['^TWII'] };

  return res.status(200).json({
    ok: Object.keys(results).length > 0,
    data: results,
    count: Object.keys(results).length,
    updatedAt: new Date().toISOString()
  });
}

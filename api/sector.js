// api/sector.js — 富果 Fugle 即時產業漲跌幅
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const FUGLE_KEY = process.env.FUGLE_TOKEN || 'ca453271-e70a-4b5a-8631-95cec32fb39a';
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

  // 依序嘗試 Fugle 可能正確的路徑
  const FUGLE_URLS = [
    'https://api.fugle.tw/marketdata/v1.0/stock/snapshot/industries/TSE',
    'https://api.fugle.tw/marketdata/v1.0/stock/snapshot/industries/TWSE',
    'https://api.fugle.tw/marketdata/v1.0/stock/snapshot/industries',
    'https://api.fugle.tw/marketdata/v1.0/stock/intraday/industries/TSE',
    'https://api.fugle.tw/marketdata/v1.0/stock/intraday/industries',
  ];

  for (const url of FUGLE_URLS) {
    try {
      const r = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${FUGLE_KEY}`,
          'User-Agent': UA,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(6000)
      });

      const raw = await r.text();
      console.log(`[sector] ${url.split('/').slice(-2).join('/')} → status:${r.status} body:${raw.slice(0,200)}`);

      if (r.ok) {
        const data = JSON.parse(raw);
        const list = Array.isArray(data) ? data
          : Array.isArray(data?.data) ? data.data
          : Array.isArray(data?.industries) ? data.industries
          : Array.isArray(data?.items) ? data.items
          : [];

        if (list.length >= 3) {
          const sectors = list.map(item => {
            const name = (item.industry || item.industryName || item.name || item.Industry || '').trim();
            const pct  = parseFloat(
              item.changePercent ?? item.change_percent ?? item.changeRatio ??
              item.priceChange?.changePercent ?? item.changeRate ?? item.pctChg ?? 0
            );
            return { name, pct: +pct.toFixed(2) };
          }).filter(s => s.name).sort((a, b) => b.pct - a.pct);

          if (sectors.length >= 3) {
            return res.status(200).json({ ok: true, sectors, source: url.split('/').slice(-2).join('/') });
          }
        }
      }
    } catch(e) {
      console.log(`[sector] ${url.split('/').slice(-1)[0]} error:`, e.message);
    }
  }

  // ── TWSE MI_INDEX20 備用 ──────────────────────────────────────
  try {
    const r = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX20', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        const sectors = data
          .filter(item => item.Index && !['加權股價指數','未含金融保險股指數','未含電子股指數'].includes(item.Index))
          .map(item => {
            const pct = parseFloat((item.ChangePercent||'0').replace(/[+%,]/g,''));
            const dir = (item.Direction||'+') === '-' ? -1 : 1;
            return { name: item.Index, pct: +(dir * pct).toFixed(2) };
          })
          .sort((a, b) => b.pct - a.pct);
        if (sectors.length >= 5)
          return res.status(200).json({ ok: true, sectors, source: 'twse_mi_index20' });
      }
    }
  } catch(e) {}

  return res.status(200).json({ ok: false, error: 'all sources failed' });
}

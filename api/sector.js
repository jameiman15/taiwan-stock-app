// api/sector.js — 富果 Fugle 即時產業漲跌幅
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');

  const FUGLE_KEY = process.env.FUGLE_TOKEN || 'ca453271-e70a-4b5a-8631-95cec32fb39a';
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

  // ── 1. Fugle snapshot/industries（最佳，即時產業指數）─────────
  try {
    const r = await fetch('https://api.fugle.tw/marketdata/v1.0/stock/snapshot/industries/TSE', {
      headers: {
        'Authorization': `Bearer ${FUGLE_KEY}`,
        'User-Agent': UA,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000)
    });

    if (r.ok) {
      const data = await r.json();
      const industries = data?.data || data?.industries || data || [];
      const list = Array.isArray(industries) ? industries : Object.values(industries);

      if (list.length >= 5) {
        const sectors = list
          .filter(item => item.industry || item.name || item.industryName)
          .map(item => {
            const name = (item.industry || item.industryName || item.name || '').trim();
            const pct  = parseFloat(item.changePercent || item.change_percent || item.pct || 0);
            return { name, pct: +pct.toFixed(2) };
          })
          .filter(s => s.name)
          .sort((a, b) => b.pct - a.pct);

        if (sectors.length >= 5) {
          return res.status(200).json({ ok: true, sectors, source: 'fugle_industries' });
        }
      }
    } else {
      console.log('Fugle industries status:', r.status, await r.text().catch(()=>''));
    }
  } catch(e) {
    console.log('Fugle industries error:', e.message);
  }

  // ── 2. Fugle snapshot/markets（備用，市場整體資料）────────────
  try {
    const r = await fetch('https://api.fugle.tw/marketdata/v1.0/stock/snapshot/markets/TSE', {
      headers: {
        'Authorization': `Bearer ${FUGLE_KEY}`,
        'User-Agent': UA,
      },
      signal: AbortSignal.timeout(8000)
    });

    if (r.ok) {
      const data = await r.json();
      console.log('markets keys:', Object.keys(data || {}).slice(0,5));
    }
  } catch(e) {}

  // ── 3. TWSE MI_INDEX20（最後備用）────────────────────────────
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

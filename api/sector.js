// api/sector.js — 富果 Fugle 即時產業漲跌幅
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const FUGLE_KEY = process.env.FUGLE_TOKEN || 'ca453271-e70a-4b5a-8631-95cec32fb39a';
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

  // ── 1. Fugle snapshot/industries TSE ─────────────────────────
  try {
    const r = await fetch('https://api.fugle.tw/marketdata/v1.0/stock/snapshot/industries/TSE', {
      headers: {
        'Authorization': `Bearer ${FUGLE_KEY}`,
        'User-Agent': UA,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000)
    });

    const raw = await r.text();
    console.log('[sector] Fugle status:', r.status);
    console.log('[sector] Fugle raw (first 800):', raw.slice(0, 800));

    if (r.ok) {
      const data = JSON.parse(raw);

      // 找出陣列
      const list = Array.isArray(data) ? data
        : Array.isArray(data?.data) ? data.data
        : Array.isArray(data?.industries) ? data.industries
        : [];

      console.log('[sector] list length:', list.length);
      if (list.length > 0) console.log('[sector] first item:', JSON.stringify(list[0]));

      if (list.length >= 3) {
        const sectors = list.map(item => {
          // 嘗試各種可能的欄位名
          const name = item.industry || item.industryName || item.name || item.Industry || '';
          const pct  = parseFloat(
            item.changePercent ?? item.change_percent ?? item.changeRatio ??
            item.priceChange?.changePercent ?? item.changeRate ?? 0
          );
          return { name: name.trim(), pct: +pct.toFixed(2) };
        })
        .filter(s => s.name)
        .sort((a, b) => b.pct - a.pct);

        return res.status(200).json({ ok: true, sectors, source: 'fugle', raw_sample: list[0] });
      }
    }
  } catch(e) {
    console.log('[sector] Fugle error:', e.message);
  }

  // ── 2. TWSE MI_INDEX20 備用 ──────────────────────────────────
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
          return res.status(200).json({ ok: true, sectors, source: 'twse' });
      }
    }
  } catch(e) {}

  return res.status(200).json({ ok: false, error: 'all sources failed' });
}

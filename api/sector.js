// api/sector.js — 抓 TWSE 各產業漲跌幅
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120'); // 2分鐘快取

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // ── 嘗試 TWSE 各類指數 ───────────────────────────────────────
  try {
    const r = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX20', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        const sectors = data
          .filter(item => item.Index && item.Index !== '加權股價指數' && item.Index !== '未含金融保險股指數' && item.Index !== '未含電子股指數')
          .map(item => {
            const pct = parseFloat((item.ChangePercent || '0').replace(/[+%,]/g, ''));
            const dir = (item.Direction || '+') === '-' ? -1 : 1;
            return {
              name: item.Index,
              pct: +(dir * pct).toFixed(2),
              change: item.Change || '0'
            };
          })
          .sort((a, b) => b.pct - a.pct);
        return res.status(200).json({ ok: true, sectors, source: 'MI_INDEX20' });
      }
    }
  } catch(e) {}

  // ── 備用：TWSE 類股指數 ──────────────────────────────────────
  try {
    const r = await fetch('https://www.twse.com.tw/rwd/zh/index/MI_5MINS_INDEX?response=json', {
      headers: { 'User-Agent': UA, 'Referer': 'https://www.twse.com.tw' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      const data = await r.json();
      // MI_5MINS_INDEX 格式不同，解析各類指數
      const fields = data?.fields || [];
      const rows   = data?.data   || [];
      if (rows.length > 0) {
        const nameIdx   = fields.indexOf('指數名稱');
        const changeIdx = fields.indexOf('漲跌百分比');
        const sectors = rows
          .filter(row => row[nameIdx] && row[changeIdx])
          .map(row => {
            const pct = parseFloat((row[changeIdx] || '0').replace(/[+%,△▽]/g, ''));
            const dir = (row[changeIdx] || '').includes('▽') ? -1 : 1;
            return { name: row[nameIdx], pct: +(dir * pct).toFixed(2) };
          })
          .sort((a, b) => b.pct - a.pct);
        if (sectors.length > 0)
          return res.status(200).json({ ok: true, sectors, source: 'MI_5MINS_INDEX' });
      }
    }
  } catch(e) {}

  // ── 備用：從已抓到的個股現價計算產業均漲跌 ──────────────────
  // 這個 fallback 需要 prices API 已抓到資料，這裡回傳 ok:false 讓前端用 AI fallback
  return res.status(200).json({ ok: false, error: 'TWSE data unavailable' });
}

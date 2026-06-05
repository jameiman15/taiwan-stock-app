// api/company-info.js — 抓 Yahoo Finance 公司基本資料
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600'); // 1小時快取

  const { code } = req.query;
  if (!code) return res.status(400).json({ ok: false, error: 'no code' });

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(code)}?modules=assetProfile,summaryDetail,defaultKeyStatistics`;
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' },
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) continue;
      const d = await r.json();
      const profile = d?.quoteSummary?.result?.[0]?.assetProfile;
      const summary = d?.quoteSummary?.result?.[0]?.summaryDetail;
      const stats   = d?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
      if (!profile) continue;

      const fmt = (v) => v?.raw != null ? v.raw : null;
      const fmtStr = (v) => v?.longFmt || v?.fmt || null;

      // 市值格式化
      const mcRaw = fmt(summary?.marketCap);
      let marketCap = '—';
      if (mcRaw) {
        if (mcRaw >= 1e12) marketCap = (mcRaw/1e12).toFixed(2)+'兆';
        else if (mcRaw >= 1e9) marketCap = (mcRaw/1e9).toFixed(1)+'億';
        else if (mcRaw >= 1e6) marketCap = (mcRaw/1e6).toFixed(0)+'百萬';
        else marketCap = mcRaw.toLocaleString();
      }

      // 業務描述截短到400字
      const desc = profile.longBusinessSummary || '';
      const shortDesc = desc.length > 400 ? desc.slice(0, 400) + '...' : desc;

      return res.status(200).json({
        ok: true,
        info: {
          longName:    profile.longName    || null,
          industry:    profile.industry    || null,
          sector:      profile.sector      || null,
          country:     profile.country     || null,
          marketCap,
          employees:   profile.fullTimeEmployees ? profile.fullTimeEmployees.toLocaleString()+'人' : null,
          description: shortDesc || null,
          website:     profile.website     || null,
        }
      });
    } catch(e) {}
  }

  return res.status(200).json({ ok: false, error: 'fetch failed' });
}

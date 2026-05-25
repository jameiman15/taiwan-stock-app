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

  // ── 3. 台指期近月 via Fugle futopt endpoint ───────────────────────
  // 台指期代碼格式：TXF + 月份英文字母 + 年份末碼
  // 月份對照：1=A 2=B 3=C 4=D 5=E 6=F 7=G 8=H 9=I 10=J 11=K 12=L
  // 結算日：每月第三個星期三，結算後近月換成下個月
  try {
    const now = new Date();
    const monthCodes = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    const yr = String(now.getFullYear()).slice(-1);

    // 計算當月第三個星期三
    const y = now.getFullYear(), mo = now.getMonth();
    let wedCount = 0, settlDay = 0;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(y, mo, d);
      if (dt.getMonth() !== mo) break;
      if (dt.getDay() === 3) { wedCount++; if (wedCount === 3) { settlDay = d; break; } }
    }
    // 若今天已過結算日，近月從下個月開始
    const baseMonth = (now.getDate() > settlDay) ? (mo + 1) % 12 : mo;
    const months = [baseMonth, (baseMonth + 1) % 12];
    let txfData = null;
    for (const m of months) {
      // 跨年處理：12月結算後換隔年1月，年份末碼要+1
      const symYr = (m < mo && mo === 11) ? String(now.getFullYear() + 1).slice(-1) : yr;
      const sym = `TXF${monthCodes[m]}${symYr}`;
      try {
        const r = await fetch(
          `https://api.fugle.tw/marketdata/v1.0/futopt/intraday/quote/${sym}`,
          { headers: { 'X-API-KEY': FUGLE_KEY }, signal: AbortSignal.timeout(5000) }
        );
        const d = await r.json();
        console.log(`TXF sym=${sym} status=${r.status} keys=${Object.keys(d||{}).join(',')} lastPrice=${d?.lastPrice} closePrice=${d?.closePrice} prevClose=${d?.previousClose}`);
        if (r.ok && d && (d.lastPrice || d.closePrice || d.previousClose)) {
          txfData = d; break;
        }
      } catch(e2) { console.log('TXF error:', e2.message); }
    }
    if (txfData) {
      const isOpen = txfData.lastPrice && (txfData.total?.tradeVolume ?? 0) > 0;
      const price  = isOpen ? txfData.lastPrice : (txfData.closePrice ?? txfData.previousClose);
      if (price && price > 0) {
        results['TW=F'] = {
          price,
          change:      +(txfData.change ?? 0).toFixed(2),
          changePct:   +(txfData.changePercent ?? 0).toFixed(2),
          name:        '台指期',
          isYesterday: !isOpen,
          source:      'Fugle',
          ok:          true
        };
      }
    }

    // 若盤中找不到（夜盤收盤後），用 previousClose
    if (!results['TW=F']) {
      for (const m of months) {
        const symYr = (m < mo && mo === 11) ? String(now.getFullYear() + 1).slice(-1) : yr;
        const sym = `TXF${monthCodes[m]}${symYr}`;
        try {
          const r2 = await fetch(
            `https://api.fugle.tw/marketdata/v1.0/futopt/intraday/quote/${sym}`,
            { headers: { 'X-API-KEY': FUGLE_KEY }, signal: AbortSignal.timeout(5000) }
          );
          if (!r2.ok) continue;
          const d2 = await r2.json();
          // 用 previousClose 作為昨收
          const price2 = d2?.previousClose ?? d2?.closePrice;
          if (price2 && price2 > 0) {
            results['TW=F'] = {
              price: price2,
              change: 0, changePct: 0,
              name: '台指期',
              isYesterday: true,
              source: 'Fugle',
              ok: true
            };
            break;
          }
        } catch(e3) {}
      }
    }
  } catch(e) {}

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

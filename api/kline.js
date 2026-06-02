// api/kline.js — 60日K線資料（Yahoo Finance，含完整技術指標）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code } = req.query;
  if (!code) return res.status(400).json({ ok: false, error: 'no code' });

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const isTW = /^\d/.test(code);

  // 台股嘗試多種後綴格式
  const symbols = isTW
    ? [`${code}.TW`, `${code}.TWO`]  // 上市用 .TW，上櫃用 .TWO
    : [code];

  let candles = [];

  for (const sym of symbols) {
    if (candles.length > 0) break;
    for (const host of ['query1', 'query2']) {
      try {
        const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=3mo`;
        const r = await fetch(url, {
          headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' },
          signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) continue;
        const d = await r.json();
        const result = d?.chart?.result?.[0];
        if (!result) continue;
        const timestamps = result.timestamp || [];
        const q = result.indicators?.quote?.[0] || {};
        const adjClose = result.indicators?.adjclose?.[0]?.adjclose || [];
        if (!timestamps.length) continue;

        const raw = timestamps.map((ts, i) => ({
          date:   new Date(ts * 1000).toISOString().slice(0, 10),
          open:   q.open?.[i]   ?? null,
          high:   q.high?.[i]   ?? null,
          low:    q.low?.[i]    ?? null,
          close:  adjClose[i] ?? q.close?.[i] ?? null,
          volume: q.volume?.[i] ?? 0,
        })).filter(c => c.close != null && c.close > 0).slice(-60);

        if (raw.length > 5) { candles = raw; break; }
      } catch(e) { continue; }
    }
  }

  if (!candles.length) {
    // 最後嘗試用 Fugle historical（免費方案有限制但試看看）
    const FUGLE_KEY = 'YTU1NzQ0ZjgtOGNlMy00MjlhLWE0ZTItMDgwYWIyMjM0YmE0IGQzMDkwNTE2LTZjZjMtNGY4My1hNmYzLTdhZDliYmU1Yjg0Zg==';
    try {
      const fr = await fetch(
        `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/${code}?timeframe=D&limit=60`,
        { headers: { 'X-API-KEY': FUGLE_KEY }, signal: AbortSignal.timeout(8000) }
      );
      if (fr.ok) {
        const fd = await fr.json();
        const fc = fd?.data?.candles || [];
        if (fc.length > 5) {
          candles = fc.map(c => ({
            date: c.date?.slice(0,10),
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume
          })).reverse().filter(c => c.close > 0);
        }
      }
    } catch(e) {}
  }

  if (!candles.length) {
    return res.status(200).json({ ok: false, error: 'no data from Yahoo or Fugle', code, tried: symbols });
  }

  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high ?? c.close);
  const lows    = candles.map(c => c.low  ?? c.close);
  const volumes = candles.map(c => c.volume);

  // ── 移動平均 ──────────────────────────────────────────────────
  const ma = (arr, n) => {
    if (arr.length < n) return null;
    return +(arr.slice(-n).reduce((a,b)=>a+b,0) / n).toFixed(2);
  };
  const ma5  = ma(closes, 5);
  const ma10 = ma(closes, 10);
  const ma20 = ma(closes, 20);
  const ma60 = ma(closes, Math.min(60, closes.length));

  const latest  = closes[closes.length - 1];
  const oldest  = closes[0];
  const high60  = +Math.max(...highs).toFixed(2);
  const low60   = +Math.min(...lows).toFixed(2);
  const trend60 = +((latest - oldest) / oldest * 100).toFixed(2);

  // ── 成交量 ────────────────────────────────────────────────────
  const volAvg  = Math.round(volumes.reduce((a,b)=>a+b,0) / volumes.length);
  const volLast = volumes[volumes.length - 1];
  const volRatio = volAvg > 0 ? +(volLast / volAvg).toFixed(2) : 1;
  const prevClose = closes[closes.length - 2] || latest;
  const priceUp   = latest > prevClose;
  const volPriceSignal =
    priceUp  && volRatio >= 1.5 ? '量增價漲（多頭強勢）' :
    priceUp  && volRatio <  0.8 ? '量縮價漲（謹慎，動能不足）' :
    !priceUp && volRatio >= 1.5 ? '量增價跌（警示，賣壓沉重）' :
    !priceUp && volRatio <  0.8 ? '量縮價跌（盤整或底部醞釀）' : '量價中性';

  // ── RSI(14) ───────────────────────────────────────────────────
  const rsiPeriod = Math.min(14, closes.length - 1);
  let gains = 0, losses = 0;
  for (let i = closes.length - rsiPeriod; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rs  = losses === 0 ? 100 : (gains / rsiPeriod) / (losses / rsiPeriod);
  const rsi = +(100 - 100 / (1 + rs)).toFixed(1);
  const rsiSignal = rsi >= 70 ? '超買區（注意回檔風險）' : rsi <= 30 ? '超賣區（可能反彈）' : rsi >= 60 ? '偏強（多方主導）' : rsi <= 40 ? '偏弱（空方主導）' : '中性區';

  // ── KD(9) ─────────────────────────────────────────────────────
  const kdPeriod = 9;
  let k = 50, dv = 50;
  if (closes.length >= kdPeriod) {
    for (let i = closes.length - kdPeriod; i < closes.length; i++) {
      const wH  = Math.max(...highs.slice(Math.max(0, i - kdPeriod + 1), i + 1));
      const wL  = Math.min(...lows.slice(Math.max(0, i - kdPeriod + 1), i + 1));
      const rsv = wH === wL ? 50 : (closes[i] - wL) / (wH - wL) * 100;
      k  = +(k  * 2/3 + rsv * 1/3).toFixed(2);
      dv = +(dv * 2/3 + k   * 1/3).toFixed(2);
    }
  }
  k = +k.toFixed(1); dv = +dv.toFixed(1);
  const kdSignal = k > 80 ? `超買（K=${k}，注意死亡交叉）` : k < 20 ? `超賣（K=${k}，等待黃金交叉）` : k > dv ? `K>D 偏多（K=${k}, D=${dv}）` : `K<D 偏空（K=${k}, D=${dv}）`;

  // ── MACD(12,26,9) ─────────────────────────────────────────────
  const ema = (arr, period) => {
    const kk = 2 / (period + 1);
    let e = arr[0];
    for (let i = 1; i < arr.length; i++) e = arr[i] * kk + e * (1 - kk);
    return +e.toFixed(3);
  };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const dif   = +(ema12 - ema26).toFixed(3);
  const difSeries = [];
  for (let i = Math.max(26, closes.length - 20); i <= closes.length; i++) {
    const sl = closes.slice(0, i);
    if (sl.length >= 26) difSeries.push(ema(sl, 12) - ema(sl, 26));
  }
  const macdLine = difSeries.length >= 9 ? ema(difSeries, 9) : dif;
  const bar      = +(dif - macdLine).toFixed(3);
  let macdSignal =
    dif > macdLine && bar > 0 ? 'DIF>MACD 柱狀體為正（多頭趨勢）' :
    dif < macdLine && bar < 0 ? 'DIF<MACD 柱狀體為負（空頭趨勢）' :
    dif > macdLine ? '柱狀體縮小（多頭動能減弱）' : '柱狀體縮小（空頭動能減弱）';
  if (difSeries.length >= 2) {
    const pd = difSeries[difSeries.length - 2];
    const pm = ema(difSeries.slice(0, -1), 9);
    if (pd < pm && dif > macdLine) macdSignal = '⚡ MACD黃金交叉（買進訊號）';
    else if (pd > pm && dif < macdLine) macdSignal = '⚠️ MACD死亡交叉（賣出訊號）';
  }

  // ── 布林通道(20,2) ────────────────────────────────────────────
  let bbSignal = '—';
  if (closes.length >= 20) {
    const bbMid = ma(closes, 20);
    const s20   = closes.slice(-20);
    const std   = Math.sqrt(s20.reduce((a,v) => a + Math.pow(v - bbMid, 2), 0) / 20);
    const bbU   = +(bbMid + 2 * std).toFixed(2);
    const bbL   = +(bbMid - 2 * std).toFixed(2);
    const bbW   = +((bbU - bbL) / bbMid * 100).toFixed(1);
    bbSignal = latest >= bbU * 0.99 ? `觸及上軌 $${bbU}（超買警示）` :
               latest <= bbL * 1.01 ? `觸及下軌 $${bbL}（超賣，可能反彈）` :
               bbW < 5  ? '通道收窄（整理末期，即將選擇方向）' :
               bbW > 15 ? `通道擴張（波動劇烈）中線$${bbMid}` :
               `通道中段，中線$${bbMid}，上軌$${bbU}，下軌$${bbL}`;
  }

  // ── 乖離率(BIAS/MA20) ─────────────────────────────────────────
  let biasSignal = '—';
  if (ma20) {
    const bias = +((latest - ma20) / ma20 * 100).toFixed(2);
    biasSignal = (bias >= 0 ? '+' : '') + bias + '%（' +
      (bias > 10 ? '嚴重偏高，回調風險大' : bias > 5 ? '偏高，謹慎追價' :
       bias < -10 ? '嚴重偏低，反彈機會' : bias < -5 ? '偏低，可留意買點' : '正常範圍') + '）';
  }

  // ── 均線排列 ──────────────────────────────────────────────────
  let maArrangement = '—';
  if (ma5 && ma10 && ma20 && ma60) {
    maArrangement =
      ma5 > ma10 && ma10 > ma20 && ma20 > ma60 ? '多頭排列（MA5>MA10>MA20>MA60）' :
      ma5 < ma10 && ma10 < ma20 && ma20 < ma60 ? '空頭排列（MA5<MA10<MA20<MA60）' :
      ma5 > ma20 && ma10 > ma20 ? '短中期多頭，長期待確認' :
      ma5 < ma20 && ma10 < ma20 ? '短中期空頭，注意下跌風險' : '均線糾結（整理盤整中）';
  }

  return res.status(200).json({
    ok: true, code, latest, high60, low60, trend60,
    ma5, ma10, ma20, ma60, maArrangement,
    rsi, rsiSignal,
    k, d: dv, kdSignal,
    dif, macdLine, bar, macdSignal,
    bbSignal, biasSignal,
    volRatio, volAvg, volLast, volPriceSignal,
    days: candles.length,
    source: 'Yahoo Finance',
    recent: candles.slice(-20).map(c => ({
      date: c.date,
      o: c.open  ? +c.open.toFixed(2)  : null,
      h: c.high  ? +c.high.toFixed(2)  : null,
      l: c.low   ? +c.low.toFixed(2)   : null,
      c: +c.close.toFixed(2),
      v: c.volume
    }))
  });
}

// api/kline.js — 60日K線資料（Yahoo Finance，含完整技術指標）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code } = req.query;
  if (!code) return res.status(400).json({ ok: false, error: 'no code' });

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // 台股代碼加 .TW 後綴，美股直接用
  const isTW = /^\d/.test(code);
  const yahooSym = isTW ? `${code}.TW` : code;

  // 嘗試兩個 Yahoo endpoint
  let candles = [];
  const URLS = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=3mo`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=3mo`,
  ];

  for (const url of URLS) {
    try {
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

      candles = timestamps.map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        open:   q.open?.[i]   ?? null,
        high:   q.high?.[i]   ?? null,
        low:    q.low?.[i]    ?? null,
        close:  adjClose[i]   ?? q.close?.[i] ?? null,
        volume: q.volume?.[i] ?? 0,
      })).filter(c => c.close != null && c.close > 0).slice(-60);
      if (candles.length > 0) break;
    } catch(e) { continue; }
  }

  if (!candles.length) {
    return res.status(200).json({ ok: false, error: 'no data from Yahoo Finance' });
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

  const latest = closes[closes.length - 1];
  const oldest = closes[0];
  const high60 = +Math.max(...highs).toFixed(2);
  const low60  = +Math.min(...lows).toFixed(2);
  const trend60 = +((latest - oldest) / oldest * 100).toFixed(2);

  // ── 成交量 ───────────────────────────────────────────────────
  const volAvg   = Math.round(volumes.reduce((a,b)=>a+b,0) / volumes.length);
  const volLast  = volumes[volumes.length - 1];
  const volRatio = volAvg > 0 ? +(volLast / volAvg).toFixed(2) : 1;
  const prevClose = closes[closes.length - 2] || latest;
  const priceUp   = latest > prevClose;
  let volPriceSignal = '';
  if      (priceUp  && volRatio >= 1.5) volPriceSignal = '量增價漲（多頭強勢）';
  else if (priceUp  && volRatio <  0.8) volPriceSignal = '量縮價漲（謹慎，動能不足）';
  else if (!priceUp && volRatio >= 1.5) volPriceSignal = '量增價跌（警示，賣壓沉重）';
  else if (!priceUp && volRatio <  0.8) volPriceSignal = '量縮價跌（盤整或底部醞釀）';
  else volPriceSignal = '量價中性';

  // ── RSI(14) ───────────────────────────────────────────────────
  let gains = 0, losses = 0;
  const rsiPeriod = Math.min(14, closes.length - 1);
  for (let i = closes.length - rsiPeriod; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / rsiPeriod;
  const avgLoss = losses / rsiPeriod;
  const rs  = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = +(100 - 100 / (1 + rs)).toFixed(1);
  const rsiSignal = rsi >= 70 ? '超買區（注意回檔風險）' : rsi <= 30 ? '超賣區（可能反彈）' : rsi >= 60 ? '偏強（多方主導）' : rsi <= 40 ? '偏弱（空方主導）' : '中性區';

  // ── KD 隨機指標(9) ───────────────────────────────────────────
  const kdPeriod = 9;
  let k = 50, d = 50;
  if (closes.length >= kdPeriod) {
    for (let i = closes.length - kdPeriod; i < closes.length; i++) {
      const windowH = Math.max(...highs.slice(Math.max(0, i - kdPeriod + 1), i + 1));
      const windowL = Math.min(...lows.slice(Math.max(0, i - kdPeriod + 1), i + 1));
      const rsv = windowH === windowL ? 50 : (closes[i] - windowL) / (windowH - windowL) * 100;
      k = +(k * 2/3 + rsv * 1/3).toFixed(2);
      d = +(d * 2/3 + k   * 1/3).toFixed(2);
    }
  }
  k = +k.toFixed(1); d = +d.toFixed(1);
  const kdSignal = k > 80 ? '超買（K='+k+'，注意死亡交叉）' : k < 20 ? '超賣（K='+k+'，等待黃金交叉）' : k > d ? 'K>D 偏多（K='+k+', D='+d+'）' : 'K<D 偏空（K='+k+', D='+d+'）';

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
    const slice = closes.slice(0, i);
    if (slice.length < 26) continue;
    difSeries.push(ema(slice, 12) - ema(slice, 26));
  }
  const macdLine = difSeries.length >= 9 ? ema(difSeries, 9) : dif;
  const bar      = +(dif - macdLine).toFixed(3);
  let macdSignal = '';
  if      (dif > macdLine && bar > 0) macdSignal = 'DIF>MACD 柱狀體為正（多頭趨勢）';
  else if (dif < macdLine && bar < 0) macdSignal = 'DIF<MACD 柱狀體為負（空頭趨勢）';
  else if (dif > macdLine && bar < 0) macdSignal = '柱狀體縮小（多頭動能減弱）';
  else macdSignal = '柱狀體縮小（空頭動能減弱）';
  if (difSeries.length >= 2) {
    const prevDif  = difSeries[difSeries.length - 2];
    const prevMacd = ema(difSeries.slice(0, -1), 9);
    if (prevDif < prevMacd && dif > macdLine) macdSignal = '⚡ MACD黃金交叉（買進訊號）';
    else if (prevDif > prevMacd && dif < macdLine) macdSignal = '⚠️ MACD死亡交叉（賣出訊號）';
  }

  // ── 布林通道(20,2) ────────────────────────────────────────────
  let bbSignal = '—';
  if (closes.length >= 20) {
    const bbMid = ma(closes, 20);
    const slice20 = closes.slice(-20);
    const variance = slice20.reduce((acc, v) => acc + Math.pow(v - bbMid, 2), 0) / 20;
    const std = Math.sqrt(variance);
    const bbUpper = +(bbMid + 2 * std).toFixed(2);
    const bbLower = +(bbMid - 2 * std).toFixed(2);
    const bbWidth = +((bbUpper - bbLower) / bbMid * 100).toFixed(1);
    if      (latest >= bbUpper * 0.99) bbSignal = '觸及上軌 $'+bbUpper+'（超買警示，注意回落）';
    else if (latest <= bbLower * 1.01) bbSignal = '觸及下軌 $'+bbLower+'（超賣，可能反彈）';
    else if (bbWidth < 5)  bbSignal = '通道收窄（整理末期，即將選擇方向）';
    else if (bbWidth > 15) bbSignal = '通道擴張（波動劇烈）中線$'+bbMid;
    else bbSignal = '通道中段，中線$'+bbMid+'，上軌$'+bbUpper+'，下軌$'+bbLower;
  }

  // ── 乖離率 (BIAS vs MA20) ─────────────────────────────────────
  let biasSignal = '—';
  if (ma20) {
    const bias = +((latest - ma20) / ma20 * 100).toFixed(2);
    biasSignal = (bias >= 0 ? '+' : '') + bias + '%（' + (bias > 10 ? '嚴重偏高，回調風險大' : bias > 5 ? '偏高，謹慎追價' : bias < -10 ? '嚴重偏低，反彈機會' : bias < -5 ? '偏低，可留意買點' : '正常範圍') + '）';
  }

  // ── 均線多空排列 ──────────────────────────────────────────────
  let maArrangement = '—';
  if (ma5 && ma10 && ma20 && ma60) {
    if      (ma5 > ma10 && ma10 > ma20 && ma20 > ma60) maArrangement = '多頭排列（MA5>MA10>MA20>MA60）';
    else if (ma5 < ma10 && ma10 < ma20 && ma20 < ma60) maArrangement = '空頭排列（MA5<MA10<MA20<MA60）';
    else if (ma5 > ma20 && ma10 > ma20) maArrangement = '短中期多頭，長期待確認';
    else if (ma5 < ma20 && ma10 < ma20) maArrangement = '短中期空頭，注意下跌風險';
    else maArrangement = '均線糾結（整理盤整中）';
  }

  return res.status(200).json({
    ok: true, code, latest, high60, low60, trend60,
    ma5, ma10, ma20, ma60, maArrangement,
    rsi, rsiSignal,
    k, d, kdSignal,
    dif, macdLine, bar, macdSignal,
    bbSignal, biasSignal,
    volRatio, volAvg, volLast, volPriceSignal,
    days: candles.length,
    source: 'Yahoo Finance',
    recent: candles.slice(-20).map(c => ({
      date: c.date,
      o: c.open ? +c.open.toFixed(2) : null,
      h: c.high ? +c.high.toFixed(2) : null,
      l: c.low  ? +c.low.toFixed(2)  : null,
      c: +c.close.toFixed(2),
      v: c.volume
    }))
  });
}

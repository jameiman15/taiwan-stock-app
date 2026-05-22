// api/kline.js — 取得個股 60 日 K 線資料
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code } = req.query;
  if (!code) return res.status(400).json({ ok: false, error: 'no code' });

  const FUGLE_KEY = 'YTU1NzQ0ZjgtOGNlMy00MjlhLWE0ZTItMDgwYWIyMjM0YmE0IGQzMDkwNTE2LTZjZjMtNGY4My1hNmYzLTdhZDliYmU1Yjg0Zg==';

  try {
    // 取得日 K 線（最近 60 根）
    const r = await fetch(
      `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/${code}?timeframe=D&limit=60`,
      { headers: { 'X-API-KEY': FUGLE_KEY }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ ok: false, error: err });
    }
    const d = await r.json();
    const candles = d?.data?.candles || [];

    if (!candles.length) return res.status(200).json({ ok: false, error: 'no data' });

    // 計算技術指標
    const closes = candles.map(c => c.close).reverse(); // 由舊到新
    const highs   = candles.map(c => c.high).reverse();
    const lows    = candles.map(c => c.low).reverse();
    const volumes = candles.map(c => c.volume).reverse();

    // 移動平均
    const ma = (arr, n) => {
      if (arr.length < n) return null;
      return +(arr.slice(-n).reduce((a,b)=>a+b,0) / n).toFixed(2);
    };

    const ma5  = ma(closes, 5);
    const ma10 = ma(closes, 10);
    const ma20 = ma(closes, 20);
    const ma60 = ma(closes, 60);

    const latest = closes[closes.length - 1];
    const oldest = closes[0];
    const high60 = Math.max(...highs);
    const low60  = Math.min(...lows);

    // 趨勢判斷
    const trend60 = ((latest - oldest) / oldest * 100).toFixed(2);
    const volAvg  = Math.round(volumes.reduce((a,b)=>a+b,0) / volumes.length);
    const volLast = volumes[volumes.length - 1];
    const volRatio = (volLast / volAvg).toFixed(2);

    // RSI(14)
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

    return res.status(200).json({
      ok: true,
      code,
      latest,
      high60, low60,
      trend60: parseFloat(trend60),
      ma5, ma10, ma20, ma60,
      rsi,
      volRatio: parseFloat(volRatio),
      days: candles.length,
      // 最近 20 根 K 線（給 AI 看）
      recent: candles.slice(0, 20).map(c => ({
        date: c.date?.slice(0,10),
        o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume
      }))
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

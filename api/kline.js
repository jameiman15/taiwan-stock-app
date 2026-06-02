// api/kline.js — 60日K線資料（TWSE主要 + Yahoo備用）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code } = req.query;
  if (!code) return res.status(400).json({ ok: false, error: 'no code' });

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const isTW = /^\d/.test(code);
  let candles = [];

  // ── 1. TWSE OpenAPI（台股，完全免費，不需 key）─────────────────
  if (isTW && candles.length === 0) {
    try {
      const today = new Date();
      const months = [0, 1, 2].map(offset => {
        const d = new Date(today.getFullYear(), today.getMonth() - offset, 1);
        return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}01`;
      });

      for (const dateStr of months) {
        try {
          const r = await fetch(
            `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${dateStr}&stockNo=${code}&response=json`,
            { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }
          );
          if (!r.ok) continue;
          const d = await r.json();
          if (d.stat !== 'OK' || !Array.isArray(d.data)) continue;
          d.data.forEach(row => {
            const close = parseFloat((row[6]||'').replace(/,/g,''));
            if (isNaN(close) || close <= 0) return;
            candles.push({
              date:   row[0]?.replace(/\//g,'-') || '',
              open:   parseFloat((row[3]||'').replace(/,/g,'')) || close,
              high:   parseFloat((row[4]||'').replace(/,/g,'')) || close,
              low:    parseFloat((row[5]||'').replace(/,/g,'')) || close,
              close,
              volume: parseInt((row[1]||'').replace(/,/g,'')) || 0,
            });
          });
        } catch(e) {}
      }
      // 按日期排序，取最近60筆
      candles = candles
        .filter(c => c.close > 0)
        .sort((a,b) => a.date.localeCompare(b.date))
        .slice(-60);
    } catch(e) {}
  }

  // ── 2. OTC（上櫃股票，TPEx）──────────────────────────────────
  if (isTW && candles.length === 0) {
    try {
      const today = new Date();
      const months = [0, 1, 2].map(offset => {
        const d = new Date(today.getFullYear(), today.getMonth() - offset, 1);
        const twY = d.getFullYear() - 1911;
        return `${twY}/${String(d.getMonth()+1).padStart(2,'0')}`;
      });

      for (const ym of months) {
        try {
          const r = await fetch(
            `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&d=${ym}&stkno=${code}`,
            { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }
          );
          if (!r.ok) continue;
          const d = await r.json();
          const rows = d?.aaData || [];
          rows.forEach(row => {
            const close = parseFloat((row[6]||'').replace(/,/g,''));
            if (isNaN(close) || close <= 0) return;
            candles.push({
              date:   row[0]?.replace(/\//g,'-') || '',
              open:   parseFloat((row[3]||'').replace(/,/g,'')) || close,
              high:   parseFloat((row[4]||'').replace(/,/g,'')) || close,
              low:    parseFloat((row[5]||'').replace(/,/g,'')) || close,
              close,
              volume: parseInt((row[1]||'').replace(/,/g,'')) || 0,
            });
          });
        } catch(e) {}
      }
      candles = candles
        .filter(c => c.close > 0)
        .sort((a,b) => a.date.localeCompare(b.date))
        .slice(-60);
    } catch(e) {}
  }

  // ── 3. Yahoo Finance（台股+美股備用）─────────────────────────
  if (candles.length === 0) {
    const symbols = isTW ? [`${code}.TW`, `${code}.TWO`] : [code];
    for (const sym of symbols) {
      if (candles.length > 0) break;
      for (const host of ['query1', 'query2']) {
        try {
          const r = await fetch(
            `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=3mo`,
            { headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' },
              signal: AbortSignal.timeout(8000) }
          );
          if (!r.ok) continue;
          const d = await r.json();
          const result = d?.chart?.result?.[0];
          if (!result?.timestamp?.length) continue;
          const q = result.indicators?.quote?.[0] || {};
          const adjClose = result.indicators?.adjclose?.[0]?.adjclose || [];
          const raw = result.timestamp.map((ts, i) => ({
            date:   new Date(ts * 1000).toISOString().slice(0, 10),
            open:   q.open?.[i] ?? null,
            high:   q.high?.[i] ?? null,
            low:    q.low?.[i]  ?? null,
            close:  adjClose[i] ?? q.close?.[i] ?? null,
            volume: q.volume?.[i] ?? 0,
          })).filter(c => c.close > 0).slice(-60);
          if (raw.length > 5) { candles = raw; break; }
        } catch(e) {}
      }
    }
  }

  if (!candles.length) {
    return res.status(200).json({ ok: false, error: 'no data', code });
  }

  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high ?? c.close);
  const lows    = candles.map(c => c.low  ?? c.close);
  const volumes = candles.map(c => c.volume);

  const ma = (arr, n) => arr.length < n ? null : +(arr.slice(-n).reduce((a,b)=>a+b,0)/n).toFixed(2);
  const ma5  = ma(closes, 5);
  const ma10 = ma(closes, 10);
  const ma20 = ma(closes, 20);
  const ma60 = ma(closes, Math.min(60, closes.length));
  const latest  = closes[closes.length-1];
  const oldest  = closes[0];
  const high60  = +Math.max(...highs).toFixed(2);
  const low60   = +Math.min(...lows).toFixed(2);
  const trend60 = +((latest-oldest)/oldest*100).toFixed(2);

  const volAvg   = Math.round(volumes.reduce((a,b)=>a+b,0)/volumes.length);
  const volLast  = volumes[volumes.length-1];
  const volRatio = volAvg > 0 ? +(volLast/volAvg).toFixed(2) : 1;
  const priceUp  = latest > (closes[closes.length-2]||latest);
  const volPriceSignal =
    priceUp  && volRatio>=1.5 ? '量增價漲（多頭強勢）' :
    priceUp  && volRatio<0.8  ? '量縮價漲（謹慎，動能不足）' :
    !priceUp && volRatio>=1.5 ? '量增價跌（警示，賣壓沉重）' :
    !priceUp && volRatio<0.8  ? '量縮價跌（盤整或底部醞釀）' : '量價中性';

  const rsiN = Math.min(14, closes.length-1);
  let gains=0, losses=0;
  for (let i=closes.length-rsiN; i<closes.length; i++) {
    const d=closes[i]-closes[i-1]; d>0?gains+=d:losses-=d;
  }
  const rs  = losses===0 ? 100 : (gains/rsiN)/(losses/rsiN);
  const rsi = +(100-100/(1+rs)).toFixed(1);
  const rsiSignal = rsi>=70?'超買區（注意回檔風險）':rsi<=30?'超賣區（可能反彈）':rsi>=60?'偏強（多方主導）':rsi<=40?'偏弱（空方主導）':'中性區';

  let k=50, dv=50;
  const kdP=9;
  if (closes.length>=kdP) {
    for (let i=closes.length-kdP; i<closes.length; i++) {
      const wH=Math.max(...highs.slice(Math.max(0,i-kdP+1),i+1));
      const wL=Math.min(...lows.slice(Math.max(0,i-kdP+1),i+1));
      const rsv=wH===wL?50:(closes[i]-wL)/(wH-wL)*100;
      k=+(k*2/3+rsv/3).toFixed(2); dv=+(dv*2/3+k/3).toFixed(2);
    }
  }
  k=+k.toFixed(1); dv=+dv.toFixed(1);
  const kdSignal=k>80?`超買（K=${k}）`:k<20?`超賣（K=${k}）`:k>dv?`K>D 偏多（K=${k},D=${dv}）`:`K<D 偏空（K=${k},D=${dv}）`;

  const ema=(arr,p)=>{ const kk=2/(p+1); let e=arr[0]; for(let i=1;i<arr.length;i++)e=arr[i]*kk+e*(1-kk); return +e.toFixed(3); };
  const dif=+(ema(closes,12)-ema(closes,26)).toFixed(3);
  const difs=[]; for(let i=Math.max(26,closes.length-20);i<=closes.length;i++){const s=closes.slice(0,i);if(s.length>=26)difs.push(ema(s,12)-ema(s,26));}
  const macdLine=difs.length>=9?ema(difs,9):dif;
  const bar=+(dif-macdLine).toFixed(3);
  let macdSignal=dif>macdLine&&bar>0?'DIF>MACD（多頭趨勢）':dif<macdLine&&bar<0?'DIF<MACD（空頭趨勢）':dif>macdLine?'多頭動能減弱':'空頭動能減弱';
  if(difs.length>=2){const pd=difs[difs.length-2],pm=ema(difs.slice(0,-1),9);if(pd<pm&&dif>macdLine)macdSignal='⚡ MACD黃金交叉';else if(pd>pm&&dif<macdLine)macdSignal='⚠️ MACD死亡交叉';}

  let bbSignal='—';
  if(closes.length>=20){const bm=ma(closes,20),s20=closes.slice(-20),std=Math.sqrt(s20.reduce((a,v)=>a+Math.pow(v-bm,2),0)/20),bU=+(bm+2*std).toFixed(2),bL=+(bm-2*std).toFixed(2),bW=+((bU-bL)/bm*100).toFixed(1);bbSignal=latest>=bU*0.99?`觸及上軌$${bU}（超買）`:latest<=bL*1.01?`觸及下軌$${bL}（超賣）`:bW<5?'通道收窄（即將選擇方向）':bW>15?`通道擴張，中線$${bm}`:`中段，中線$${bm}，上軌$${bU}，下軌$${bL}`;}

  let biasSignal='—';
  if(ma20){const b=+((latest-ma20)/ma20*100).toFixed(2);biasSignal=(b>=0?'+':'')+b+'%（'+(b>10?'嚴重偏高':b>5?'偏高謹慎':b<-10?'嚴重偏低':b<-5?'偏低可留意':'正常範圍')+'）';}

  let maArrangement='—';
  if(ma5&&ma10&&ma20&&ma60)maArrangement=ma5>ma10&&ma10>ma20&&ma20>ma60?'多頭排列':ma5<ma10&&ma10<ma20&&ma20<ma60?'空頭排列':ma5>ma20&&ma10>ma20?'短中期多頭':ma5<ma20&&ma10<ma20?'短中期空頭':'均線糾結';

  return res.status(200).json({
    ok:true, code, latest, high60, low60, trend60,
    ma5, ma10, ma20, ma60, maArrangement,
    rsi, rsiSignal, k, d:dv, kdSignal,
    dif, macdLine, bar, macdSignal,
    bbSignal, biasSignal,
    volRatio, volAvg, volLast, volPriceSignal,
    days: candles.length, source: candles[0]?.date ? 'TWSE/Yahoo' : 'unknown',
    recent: candles.slice(-10).map(c=>({date:c.date,o:c.open?+c.open.toFixed(2):null,h:c.high?+c.high.toFixed(2):null,l:c.low?+c.low.toFixed(2):null,c:+c.close.toFixed(2),v:c.volume}))
  });
}

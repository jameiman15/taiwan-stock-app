// /api/keep-alive.js
// 用途：由 Vercel Cron 定期呼叫，對 Supabase 做一次真正的資料庫查詢，
// 避免 Supabase Free 方案因 7 天無資料庫活動而自動暫停。
//
// 使用前請先完成：
// 1. 在 Vercel 專案的環境變數加上：
//    SUPABASE_URL          -> 你的 Supabase 專案 URL（例如 https://boewvtbfgwfdeyedlvel.supabase.co）
//    SUPABASE_ANON_KEY     -> 你的 Supabase anon public key
//    CRON_SECRET           -> 自己設一組隨機字串，用來擋掉外部亂打這支 API
// 2. 把下面 TABLE_NAME 換成你資料庫裡「實際存在」的 table 名稱
//    （哪張表都可以，只要有一次真的查詢打到資料庫即可，不需要是持倉表）

import { createClient } from '@supabase/supabase-js';

const TABLE_NAME = 'portfolios'; // ← 換成你專案裡實際存在的 table 名稱

export default async function handler(req, res) {
  // 簡單的保護，避免這支 API 被外部隨意呼叫觸發
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // 只是要有一次「真的打到資料庫」的查詢，查不到資料也沒關係
    const { error } = await supabase
      .from(TABLE_NAME)
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    const timestamp = new Date().toISOString();
    console.log(`[keep-alive] Supabase ping 成功 @ ${timestamp}`);
    return res.status(200).json({ ok: true, timestamp });
  } catch (err) {
    console.error('[keep-alive] Supabase ping 失敗:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

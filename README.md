# 台股 AI 投資儀表板

## 檔案結構

```
taiwan-stock-app/
├── index.html        ← 主應用程式（手機優先 PWA）
├── api/
│   └── prices.js     ← Vercel Serverless Function（股價 proxy）
├── manifest.json     ← 手機安裝設定
├── vercel.json       ← Vercel 部署設定
└── package.json
```

---

## 🚀 部署到 Vercel（5 分鐘）

### 步驟 1：上傳到 GitHub
```bash
git init
git add .
git commit -m "init taiwan stock app"
# 在 github.com 建立新 repo，然後：
git remote add origin https://github.com/你的帳號/taiwan-stock-app.git
git push -u origin main
```

### 步驟 2：連結 Vercel
1. 前往 https://vercel.com → 用 GitHub 帳號登入
2. 點 **Add New → Project**
3. 選你的 `taiwan-stock-app` repo
4. **Framework Preset 選 "Other"**
5. 點 **Deploy** → 等約 30 秒

### 步驟 3：取得網址
部署完成後 Vercel 給你網址，例如：
`https://taiwan-stock-app-abc123.vercel.app`

---

## 📡 股價 API 架構

```
手機瀏覽器
    ↓ 呼叫 /api/prices
Vercel Serverless Function (api/prices.js)
    ├─ TWSE OpenAPI (台股上市個股、ETF 收盤價)
    │   https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL
    ├─ TPEx API (上櫃個股)
    │   https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes
    └─ Yahoo Finance (美股指數：道瓊、那斯達克、台積電ADR)
        https://query1.finance.yahoo.com/v8/finance/chart/^DJI
```

**為什麼需要 Serverless Function？**
瀏覽器直接呼叫 TWSE 時有 CORS 限制（安全政策），
透過 Vercel 的伺服器端呼叫就完全沒有這個問題。

---

## 📱 手機加到主畫面

**iPhone（Safari）：**
1. 用 Safari 開啟你的 Vercel 網址
2. 點底部分享按鈕 □↑
3. 選「加入主畫面」→ 完成

**Android（Chrome）：**
1. 右上角三點選單 ⋮
2. 選「安裝應用程式」或「加入主畫面」

---

## ⏰ 股價更新頻率

- 台股（TWSE/TPEx）：**盤後資料**，每日 14:00 後更新
- 美股指數（Yahoo）：**即時延遲15分鐘**
- App 內自動更新：每 **60 秒**重新呼叫 API

---

## 🔧 自訂持倉

持倉資料存在瀏覽器 `localStorage`，換裝置時需重新輸入。
若需跨裝置同步，可在 `api/prices.js` 加入簡單的資料庫（Vercel KV 或 Supabase）。

---

## 常見問題

**Q: 部署後股價顯示 "---"？**  
A: TWSE API 在非交易時間（例如假日、早上9點前）可能無資料。
   等盤後 14:00-18:00 刷新即可。

**Q: 想加更多自訂功能？**  
A: 修改 `index.html` 的 `DEFAULT_PF`、`DIAG`、`AI_RECS` 等常數即可。
   每次改完 push 到 GitHub，Vercel 自動重新部署。

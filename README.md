# GlobalHistory

單檔式世界史與中國史時間地圖。主頁可由 GitHub Pages 靜態部署；AI 小助手需要另外啟動或部署 Node 後端。

## 網頁

- `index.html`: 世界史時間地圖。
- `china-history.html`: 中國史時間地圖，包含君主/首腦欄、大事件、手機版介面與 AI 小助手。
- `china-history.css`: 中國史頁樣式。
- `server.js`: AI 小助手後端，負責安全地呼叫 Gemini API。

## 本機執行 AI 小助手

1. 安裝依賴：

```bash
npm install
```

2. 建立 `.env`，內容可參考 `.env.example`：

```env
GEMINI_API_KEY=你的 Gemini API key
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_TIMEOUT_MS=90000
PORT=3000
HISTORY_ASSISTANT_ALLOWED_ORIGINS=https://shishiyen.github.io,http://localhost:3000
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
AI_WEEKLY_TOKEN_LIMIT=500000
AI_WEEKLY_WARNING_RATIO=0.8
AI_HARD_PAUSE_ENABLED=true
ALERT_WEBHOOK_URL=
ALERT_EMAIL_TO=
```

本機沒有設定 Upstash Redis 時，後端會使用記憶體計數，方便開發測試；正式上線請務必設定 Upstash Redis，否則 Render 重啟後 token 用量會歸零。

3. 啟動後端：

```bash
npm start
```

4. 開啟：

```text
http://localhost:3000/china-history.html
```

不要用 `python -m http.server` 或只開 GitHub Pages 測 AI，因為那些只會提供靜態 HTML，沒有 `/api/history-assistant` 後端。

## GitHub Pages 與 AI 限制

GitHub Pages 只能放靜態檔案，不能執行 `server.js`，也不能保存 `.env` 裡的 `GEMINI_API_KEY`。因此：

- `https://shishiyen.github.io/ChinaHistoryMap/china-history.html` 可以顯示時間地圖。
- AI 小助手需要另外部署 Node 後端。
- 目前前端已設定正式 AI endpoint：`https://global-history-ai.onrender.com/api/history-assistant`。
- 如果後端和 GitHub Pages 不同網域，後端必須允許 CORS；本專案已用 `HISTORY_ASSISTANT_ALLOWED_ORIGINS` 控制允許來源。

## Render 部署 AI 後端

本專案包含 `render.yaml`，可在 Render 建立 Blueprint/Web Service：

- Build command: `npm ci`
- Start command: `npm start`
- Service name: `global-history-ai`
- Health check path: `/api/health`

Render 環境變數：

```env
GEMINI_API_KEY=你的 Gemini API key
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_TIMEOUT_MS=90000
HISTORY_ASSISTANT_ALLOWED_ORIGINS=https://shishiyen.github.io,http://localhost:3000
UPSTASH_REDIS_REST_URL=你的 Upstash Redis REST URL
UPSTASH_REDIS_REST_TOKEN=你的 Upstash Redis REST token
AI_WEEKLY_TOKEN_LIMIT=500000
AI_WEEKLY_WARNING_RATIO=0.8
AI_HARD_PAUSE_ENABLED=true
ALERT_WEBHOOK_URL=你的 email webhook URL
ALERT_EMAIL_TO=你的通知信箱
```

不要在 Render 設定固定 `PORT`；Render 會自動提供。

AI 小助手的防濫用限制在後端執行：

- 每週 token 上限預設 `500000`，以台北時間週一切換新的週期。
- 達到 `AI_WEEKLY_WARNING_RATIO` 預設 80% 時，會對 `ALERT_WEBHOOK_URL` 發送一次警告。
- 達到週上限或發生全站短時間異常流量時，會自動暫停本週 AI 呼叫，後續請求不會再呼叫 Gemini。
- 單一 IP 預設限制為每分鐘 10 次、每小時 40 次；全站每分鐘超過 30 次會視為異常流量。
- 告警 webhook 會收到 JSON，包含 `to`、`subject`、`text` 與 `event` 欄位；實際寄信服務由 webhook 端負責。

部署後確認：

```text
https://global-history-ai.onrender.com/api/health
```

如果你在 Render 使用不同 service name，請同步更新 `china-history.html` 裡的 `hostedAssistantApiEndpoint`。

## GitHub Pages 發布

目前 repository remote：

```text
https://github.com/ShishiYen/ChinaHistoryMap.git
```

一般更新流程：

```bash
git add index.html china-history.html china-history.css server.js README.md package.json package-lock.json .env.example
git commit -m "Update history map"
git push origin main
```

GitHub Pages 會在 push 後重新部署。

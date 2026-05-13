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
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_TIMEOUT_MS=45000
PORT=3000
HISTORY_ASSISTANT_ALLOWED_ORIGINS=https://shishiyen.github.io,http://localhost:3000,http://localhost:5173
```

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
- AI 小助手不會在 GitHub Pages 上直接運作。
- 要讓線上版也能用 AI，需要把 `server.js` 部署到 Render、Railway、Vercel、Fly.io 或其他 Node 後端。
- 如果後端和 GitHub Pages 不同網域，後端必須允許 CORS；本專案已用 `HISTORY_ASSISTANT_ALLOWED_ORIGINS` 控制允許來源。

部署好後端後，把 `china-history.html` 內這行改成你的 API 網址：

```js
const hostedAssistantApiEndpoint = "https://你的後端網域/api/history-assistant";
```

然後重新 commit、push 到 GitHub Pages。

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

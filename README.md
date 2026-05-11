# GlobalHistory

互動式歷史時間地圖專案，使用單一 HTML 檔內嵌 CSS 與 JavaScript 實作，不需要額外建置工具即可在瀏覽器中開啟。

## 目前檔案

- `index.html`：全世界歷史時間地圖。以 Canvas 呈現西元前 3500 年到 2026 年的跨區域歷史政權、文明、事件與影響關係。包含拖曳、滾輪縮放、搜尋、區域顯示/隱藏、小地圖、提示框與右鍵開啟維基百科連結。
- `china-history.html`：中國史時間地圖。以 Canvas 呈現西元前 2100 年到 2026 年的中國歷史主軸、朝代政權、君主/首腦、制度文化事件與近現代事件。包含時間範圍切換、事件列表、小地圖、搜尋、手機軌道切換、資料驗證與維基百科連結。

## 使用方式

直接用瀏覽器開啟以下任一檔案：

- `index.html`
- `china-history.html`

## 技術概要

- 前端：HTML、CSS、原生 JavaScript
- 視覺化：Canvas 2D
- 資料形式：JavaScript 陣列內嵌於各 HTML 檔案
- 外部連結：Wikipedia / Wikidata 名稱連結

## Git 狀態

此資料夾已是 Git repository，主要分支為 `main`，並已設定遠端 `origin`：

`https://github.com/ShishiYen/ChinaHistoryMap.git`

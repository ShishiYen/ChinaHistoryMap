import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.HISTORY_ASSISTANT_ALLOWED_ORIGINS ||
  "https://shishiyen.github.io,http://localhost:3000,http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

app.use(express.json({ limit: "160kb" }));
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});
app.use(express.static(process.cwd(), { extensions: ["html"] }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "global-history-ai",
    model: currentModel()
  });
});

function clampRange(value) {
  const range = Number(value);
  if (!Number.isFinite(range)) return 3;
  return Math.max(1, Math.min(5, Math.round(range)));
}

function normalizeYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return null;
  return Math.round(year);
}

function truncateText(value, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function timeoutMessage() {
  return "Gemini 回應逾時。請稍後重試，或把 GEMINI_MODEL 改成 gemini-3-flash-preview / gemini-2.5-flash 測試。";
}

function currentModel() {
  return process.env.GEMINI_MODEL || "gemini-3-pro-preview";
}

function currentTimeoutMs() {
  const timeout = Number(process.env.GEMINI_TIMEOUT_MS || 45000);
  return Number.isFinite(timeout) ? Math.max(10000, Math.min(timeout, 120000)) : 45000;
}

function compactEntries(entries, limit = 60) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, limit).map((entry) => ({
    name: truncateText(entry?.name, 80),
    type: truncateText(entry?.type, 28),
    time: truncateText(entry?.time, 42),
    polity: truncateText(entry?.polity, 60),
    track: truncateText(entry?.track, 60),
    note: truncateText(entry?.note, 120)
  }));
}

function buildPrompt({ year, rangeYears, prompt, context }) {
  const ruler = context?.ruler || null;
  const core = context?.core || null;
  const windowLabel = year < 0
    ? `西元前 ${Math.abs(year)} 年前後 ${rangeYears} 年`
    : `西元 ${year} 年前後 ${rangeYears} 年`;

  return [
    "你是嚴謹的中國史研究助手，請以繁體中文回答。",
    "任務：根據使用者指定年份附近的史實，整理內憂與外患，推測當時君主或當權者的心境，最後用第一人稱口吻敘述。",
    "請優先使用提供的時間軸上下文；若上下文不足，使用 Google Search grounding 補足，並避免捏造。若史實有爭議或資料不足，請明確說明。",
    "",
    `指定時間：${windowLabel}`,
    `使用者補充問題：${truncateText(prompt, 700) || "請分析當時政局。"}`,
    `當時統治者候選：${ruler ? JSON.stringify(ruler) : "未從本地時間軸找到，請以當權統治者或政權核心視角處理。"}`,
    `中原主軸/政權背景：${core ? JSON.stringify(core) : "未從本地時間軸找到。"}`,
    `本地時間軸上下文：${JSON.stringify({
      rulers: compactEntries(context?.rulers, 20),
      coreAxis: compactEntries(context?.coreAxis, 12),
      events: compactEntries(context?.events, 30),
      periods: compactEntries(context?.periods, 35)
    })}`,
    "",
    "輸出格式固定如下：",
    "## 時局摘要",
    "用 2-4 句說明當時發生了什麼。",
    "## 內憂",
    "列出朝廷、制度、財政、民變、權臣、地方割據等內部壓力。",
    "## 外患",
    "列出邊疆、敵國、戰爭、外交、全球局勢等外部壓力。",
    "## 君主心境推測",
    "用謹慎語氣推測，不要把推測寫成確定史實。",
    "## 朕之獨白",
    "以該君主或當權者第一人稱口吻寫 1-2 段，語氣可有古典感，但要清楚易懂。",
    "## 史實不確定性",
    "說明哪些部分是推測、哪些部分需要更多史料確認。"
  ].join("\n");
}

function extractCitations(response) {
  const chunks = response?.candidates?.flatMap((candidate) => (
    candidate?.groundingMetadata?.groundingChunks || []
  )) || [];

  const seen = new Set();
  return chunks
    .map((chunk) => chunk?.web)
    .filter((web) => web?.uri)
    .filter((web) => {
      if (seen.has(web.uri)) return false;
      seen.add(web.uri);
      return true;
    })
    .slice(0, 8)
    .map((web) => ({
      title: web.title || web.uri,
      url: web.uri
    }));
}

app.post("/api/history-assistant", async (req, res) => {
  try {
    const year = normalizeYear(req.body?.year);
    if (year === null || year < -2100 || year > 2026) {
      return res.status(400).json({ error: "年份必須介於西元前 2100 到西元 2026。" });
    }

    dotenv.config({ override: false });
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "伺服器尚未設定 GEMINI_API_KEY。請建立 .env 並重新啟動 npm start。"
      });
    }

    const rangeYears = clampRange(req.body?.rangeYears);
    const userPrompt = truncateText(req.body?.prompt, 700);
    const context = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
    const model = currentModel();
    const requestTimeoutMs = currentTimeoutMs();
    const ai = new GoogleGenAI({ apiKey, timeout: Math.min(requestTimeoutMs, 30000) });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response;
    try {
      response = await ai.models.generateContent({
        model,
        contents: buildPrompt({ year, rangeYears, prompt: userPrompt, context }),
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.55,
          maxOutputTokens: 1800,
          abortSignal: controller.signal
        }
      });
    } catch (error) {
      if (error?.name === "AbortError" || /abort|timeout/i.test(error?.message || "")) {
        return res.status(504).json({ error: timeoutMessage() });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const answer = response?.text || "";
    if (!answer.trim()) {
      return res.status(502).json({ error: "Gemini 沒有回傳可顯示的內容。" });
    }

    return res.json({
      answer,
      citations: extractCitations(response),
      model,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("[history-assistant]", error);
    return res.status(502).json({
      error: "呼叫 Gemini API 時發生錯誤。請確認 API key、模型名稱與網路連線。"
    });
  }
});

app.listen(port, () => {
  console.log(`GlobalHistory server running at http://localhost:${port}`);
});

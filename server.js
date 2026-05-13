import crypto from "node:crypto";
import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

const port = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.HISTORY_ASSISTANT_ALLOWED_ORIGINS ||
  "https://shishiyen.github.io,http://localhost:3000,http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const hasRedis = Boolean(redisUrl && redisToken);
const localStore = new Map();

const weeklyTokenLimit = positiveNumber(process.env.AI_WEEKLY_TOKEN_LIMIT, 500000);
const weeklyWarningRatio = boundedNumber(process.env.AI_WEEKLY_WARNING_RATIO, 0.8, 0.01, 0.99);
const hardPauseEnabled = parseBoolean(process.env.AI_HARD_PAUSE_ENABLED, true);
const alertWebhookUrl = process.env.ALERT_WEBHOOK_URL || "";
const alertEmailTo = process.env.ALERT_EMAIL_TO || "";

const ttl = {
  minute: 90,
  hour: 3900,
  week: 10 * 24 * 60 * 60
};

const limits = {
  perIpMinute: 10,
  perIpHour: 40,
  globalMinute: 30
};

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
  const week = currentTaipeiWeek();
  res.json({
    ok: true,
    service: "global-history-ai",
    model: currentModel(),
    aiBudget: {
      store: hasRedis ? "upstash-redis" : "memory",
      weeklyTokenLimit,
      hardPauseEnabled,
      week: week.key
    }
  });
});

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

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
  return "Gemini 回應逾時。請稍後重試，或把 GEMINI_TIMEOUT_MS 調高。";
}

function currentModel() {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
}

function currentTimeoutMs() {
  const timeout = Number(process.env.GEMINI_TIMEOUT_MS || 90000);
  return Number.isFinite(timeout) ? Math.max(10000, Math.min(timeout, 180000)) : 90000;
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
    "你是中國史與世界史分析助手，請用當時君主/首腦的視角回答。",
    "請把回答聚焦在統治者會感受到的內政壓力、外部威脅、制度限制、資訊不完整與決策情緒，不要寫成普通百科摘要。",
    "可以使用 Google Search grounding 補充史實，但不要虛構來源；若資料不確定，請明確說明不確定。",
    "",
    `分析時間窗：${windowLabel}`,
    `使用者問題：${truncateText(prompt, 700) || "請分析這段時間的統治壓力與可能決策。"} `,
    `代表君主/首腦：${ruler ? JSON.stringify(ruler) : "目前資料沒有可對應的代表君主/首腦。"}`,
    `核心政權/時代：${core ? JSON.stringify(core) : "目前資料沒有可對應的核心政權。"}`,
    `時間窗附近資料：${JSON.stringify({
      rulers: compactEntries(context?.rulers, 20),
      coreAxis: compactEntries(context?.coreAxis, 12),
      events: compactEntries(context?.events, 30),
      periods: compactEntries(context?.periods, 35)
    })}`,
    "",
    "請輸出以下段落：",
    "## 局勢總覽",
    "用 2-4 句說明這段時間統治者面對的局勢。",
    "## 內部壓力",
    "列出財政、官僚、地方、繼承、民變或制度限制等內部壓力。",
    "## 外部威脅",
    "列出邊疆、鄰國、戰爭、外交、貿易或文化競爭等外部壓力。",
    "## 君主心境推測",
    "用謹慎口吻推測統治者可能的恐懼、焦慮、野心或誤判。",
    "## 第一人稱獨白",
    "用當時統治者口吻寫 1-2 段短獨白，避免現代詞彙過多。",
    "## 史實不確定性",
    "說明哪些判斷是依據資料推測，哪些需要更多史料確認。"
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

function taipeiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function currentTaipeiWeek(date = new Date()) {
  const parts = taipeiDateParts(date);
  const localDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const day = localDate.getUTCDay() || 7;
  localDate.setUTCDate(localDate.getUTCDate() + 4 - day);
  const weekYear = localDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil((((localDate - yearStart) / 86400000) + 1) / 7);
  return {
    year: weekYear,
    week: weekNumber,
    key: `${weekYear}-W${String(weekNumber).padStart(2, "0")}`
  };
}

function keyHash(value) {
  return crypto.createHash("sha256").update(value || "unknown").digest("hex").slice(0, 16);
}

function getClientIp(req) {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function requestContext(req) {
  const ip = getClientIp(req);
  return {
    ip,
    ipHash: keyHash(ip),
    origin: req.get("origin") || "none",
    userAgent: truncateText(req.get("user-agent") || "unknown", 180)
  };
}

async function redisCommand(command) {
  if (!hasRedis) return memoryCommand(command);

  const response = await fetch(redisUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Redis command failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  if (payload?.error) throw new Error(`Redis command failed: ${payload.error}`);
  return payload?.result;
}

function purgeExpiredMemory() {
  const now = Date.now();
  for (const [key, entry] of localStore.entries()) {
    if (entry.expiresAt && entry.expiresAt <= now) localStore.delete(key);
  }
}

function memoryCommand(command) {
  purgeExpiredMemory();
  const [name, key, ...args] = command;
  const op = String(name).toUpperCase();
  const current = localStore.get(key);

  if (op === "GET") return current?.value ?? null;
  if (op === "INCR" || op === "INCRBY") {
    const by = op === "INCRBY" ? Number(args[0] || 0) : 1;
    const next = Number(current?.value || 0) + by;
    localStore.set(key, { value: next, expiresAt: current?.expiresAt || null });
    return next;
  }
  if (op === "EXPIRE") {
    if (!current) return 0;
    current.expiresAt = Date.now() + Number(args[0]) * 1000;
    localStore.set(key, current);
    return 1;
  }
  if (op === "SET") {
    const value = args[0];
    const optionText = args.map((arg) => String(arg).toUpperCase());
    if (optionText.includes("NX") && current) return null;
    const exIndex = optionText.indexOf("EX");
    const expiresAt = exIndex >= 0 ? Date.now() + Number(args[exIndex + 1]) * 1000 : null;
    localStore.set(key, { value, expiresAt });
    return "OK";
  }
  if (op === "DEL") {
    return localStore.delete(key) ? 1 : 0;
  }
  throw new Error(`Unsupported memory Redis command: ${op}`);
}

async function getNumber(key) {
  const value = await redisCommand(["GET", key]);
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

async function incrByWithTtl(key, by, seconds) {
  const value = await redisCommand(["INCRBY", key, by]);
  if (Number(value) === by) await redisCommand(["EXPIRE", key, seconds]);
  return Number(value || 0);
}

async function setWithTtl(key, value, seconds) {
  return redisCommand(["SET", key, value, "EX", seconds]);
}

async function setOnceWithTtl(key, value, seconds) {
  return redisCommand(["SET", key, value, "EX", seconds, "NX"]);
}

function budgetKeys() {
  const week = currentTaipeiWeek();
  return {
    week,
    usage: `ai:usage:${week.key}`,
    pause: `ai:pause:${week.key}`,
    warningAlert: `ai:alert:${week.key}:budget-warning`,
    exhaustedAlert: `ai:alert:${week.key}:budget-exhausted`,
    attackAlert: `ai:alert:${week.key}:attack`
  };
}

async function sendAlert(type, details) {
  if (!alertWebhookUrl) {
    console.warn("[ai-alert]", type, details);
    return false;
  }

  const subject = `[GlobalHistory AI] ${type}`;
  const text = [
    subject,
    `time: ${new Date().toISOString()}`,
    `model: ${currentModel()}`,
    ...Object.entries(details).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
  ].join("\n");

  try {
    const response = await fetch(alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: alertEmailTo,
        subject,
        text,
        event: {
          type,
          service: "global-history-ai",
          time: new Date().toISOString(),
          model: currentModel(),
          ...details
        }
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("[ai-alert] webhook failed", response.status, body);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[ai-alert] webhook error", error);
    return false;
  }
}

async function sendAlertOnce(key, type, details) {
  const wasSet = await setOnceWithTtl(key, new Date().toISOString(), ttl.week);
  if (wasSet) await sendAlert(type, details);
}

async function pauseAi(reason, details = {}) {
  if (!hardPauseEnabled) return;
  const keys = budgetKeys();
  await setWithTtl(keys.pause, reason, ttl.week);
  await sendAlertOnce(keys.exhaustedAlert, "AI paused", { reason, ...details });
}

async function checkRequestGate(req) {
  const keys = budgetKeys();
  const context = requestContext(req);
  const pauseReason = await redisCommand(["GET", keys.pause]);
  const currentTokens = await getNumber(keys.usage);

  if (pauseReason) {
    return {
      allowed: false,
      status: 429,
      error: pauseReason === "weekly-budget-exhausted"
        ? "AI 小助手本週額度已用完，請下週再試。"
        : "AI 小助手暫時維護中，請稍後再試。",
      currentTokens,
      context
    };
  }

  if (currentTokens >= weeklyTokenLimit) {
    await pauseAi("weekly-budget-exhausted", {
      weeklyTokenLimit,
      currentTokens,
      week: keys.week.key,
      ipHash: context.ipHash,
      origin: context.origin
    });
    return {
      allowed: false,
      status: 429,
      error: "AI 小助手本週額度已用完，請下週再試。",
      currentTokens,
      context
    };
  }

  const minute = Math.floor(Date.now() / 60000);
  const hour = Math.floor(Date.now() / 3600000);
  const ipMinuteKey = `ai:rate:ip:${context.ipHash}:m:${minute}`;
  const ipHourKey = `ai:rate:ip:${context.ipHash}:h:${hour}`;
  const globalMinuteKey = `ai:rate:global:m:${minute}`;
  const [ipMinuteCount, ipHourCount, globalMinuteCount] = await Promise.all([
    incrByWithTtl(ipMinuteKey, 1, ttl.minute),
    incrByWithTtl(ipHourKey, 1, ttl.hour),
    incrByWithTtl(globalMinuteKey, 1, ttl.minute)
  ]);

  if (globalMinuteCount > limits.globalMinute) {
    const details = {
      reason: "global-minute-spike",
      globalMinuteCount,
      globalMinuteLimit: limits.globalMinute,
      ipMinuteCount,
      ipHourCount,
      currentTokens,
      weeklyTokenLimit,
      week: keys.week.key,
      ipHash: context.ipHash,
      origin: context.origin,
      userAgent: context.userAgent
    };
    if (hardPauseEnabled) await setWithTtl(keys.pause, "traffic-spike", ttl.week);
    await sendAlertOnce(keys.attackAlert, "AI traffic spike", details);
    return {
      allowed: false,
      status: 429,
      error: "AI 小助手暫時維護中，請稍後再試。",
      currentTokens,
      context
    };
  }

  if (ipMinuteCount > limits.perIpMinute || ipHourCount > limits.perIpHour) {
    await sendAlertOnce(`${keys.attackAlert}:ip:${context.ipHash}`, "AI per-IP rate limit", {
      reason: "per-ip-rate-limit",
      ipMinuteCount,
      ipMinuteLimit: limits.perIpMinute,
      ipHourCount,
      ipHourLimit: limits.perIpHour,
      globalMinuteCount,
      currentTokens,
      weeklyTokenLimit,
      week: keys.week.key,
      ipHash: context.ipHash,
      origin: context.origin,
      userAgent: context.userAgent
    });
    return {
      allowed: false,
      status: 429,
      error: "請求太頻繁，請稍後再試。",
      currentTokens,
      context
    };
  }

  return {
    allowed: true,
    currentTokens,
    context,
    counts: { ipMinuteCount, ipHourCount, globalMinuteCount }
  };
}

function fallbackTokenEstimate(promptText, answerText) {
  return Math.max(1, Math.ceil(promptText.length / 2) + Math.ceil(answerText.length / 2) + 256);
}

function usageTokenCount(response, promptText, answerText) {
  const usage = response?.usageMetadata || {};
  const total = Number(usage.totalTokenCount);
  if (Number.isFinite(total) && total > 0) return Math.ceil(total);

  const promptTokens = Number(usage.promptTokenCount);
  const candidateTokens = Number(usage.candidatesTokenCount);
  if (Number.isFinite(promptTokens) && Number.isFinite(candidateTokens) && promptTokens + candidateTokens > 0) {
    return Math.ceil(promptTokens + candidateTokens);
  }

  return fallbackTokenEstimate(promptText, answerText);
}

async function recordTokenUsage(tokenCount, gate, response) {
  const keys = budgetKeys();
  const updatedTokens = await incrByWithTtl(keys.usage, tokenCount, ttl.week);
  const warningAt = Math.floor(weeklyTokenLimit * weeklyWarningRatio);
  const alertBase = {
    week: keys.week.key,
    tokenCount,
    currentTokens: updatedTokens,
    weeklyTokenLimit,
    warningAt,
    ipHash: gate.context.ipHash,
    origin: gate.context.origin,
    counts: gate.counts || null,
    usageMetadata: response?.usageMetadata || null
  };

  if (updatedTokens >= warningAt && updatedTokens < weeklyTokenLimit) {
    await sendAlertOnce(keys.warningAlert, "AI weekly token warning", alertBase);
  }

  if (updatedTokens >= weeklyTokenLimit) {
    if (hardPauseEnabled) await setWithTtl(keys.pause, "weekly-budget-exhausted", ttl.week);
    await sendAlertOnce(keys.exhaustedAlert, "AI weekly token exhausted", alertBase);
  }

  return updatedTokens;
}

app.post("/api/history-assistant", async (req, res) => {
  try {
    const year = normalizeYear(req.body?.year);
    if (year === null || year < -2100 || year > 2026) {
      return res.status(400).json({ error: "年份必須介於西元前 2100 到西元 2026。" });
    }

    const gate = await checkRequestGate(req);
    if (!gate.allowed) {
      return res.status(gate.status).json({
        error: gate.error,
        weeklyTokenLimit,
        currentTokens: gate.currentTokens
      });
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
    const promptText = buildPrompt({ year, rangeYears, prompt: userPrompt, context });
    const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: requestTimeoutMs } });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response;
    try {
      response = await ai.models.generateContent({
        model,
        contents: promptText,
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

    const tokenCount = usageTokenCount(response, promptText, answer);
    const currentTokens = await recordTokenUsage(tokenCount, gate, response);

    return res.json({
      answer,
      citations: extractCitations(response),
      model,
      createdAt: new Date().toISOString(),
      usage: {
        tokenCount,
        currentTokens,
        weeklyTokenLimit
      }
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
  if (!hasRedis) {
    console.warn("AI usage budget is using in-memory storage. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for production.");
  }
});

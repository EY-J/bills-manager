import { Buffer } from "node:buffer";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT_LENGTH = 2000;
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_MAX_BUCKETS = 1000;
const rateLimitBuckets = new Map();

function toSafeString(value, fallback = "", maxLen = MAX_TEXT_LENGTH) {
  if (value == null) return fallback;
  const text = String(value);
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function normalizeContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value).slice(0, 20);
  const result = {};
  for (const [key, raw] of entries) {
    result[toSafeString(key, "unknown", 80)] = toSafeString(raw, "", 240);
  }
  return result;
}

function readPayload(req) {
  const body = req.body;
  if (!body) return null;

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  if (typeof body === "object") return body;
  return null;
}

function getBodyBytes(value) {
  if (value == null) return 0;
  try {
    if (typeof value === "string") {
      return Buffer.byteLength(value, "utf8");
    }
    if (typeof value === "object") {
      return Buffer.byteLength(JSON.stringify(value), "utf8");
    }
  } catch {
    return MAX_BODY_BYTES + 1;
  }
  return 0;
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").trim();
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = String(req.headers["x-real-ip"] || "").trim();
  if (realIp) return realIp;
  return req.socket?.remoteAddress || "unknown";
}

function trimRateLimitBuckets(now) {
  if (rateLimitBuckets.size <= RATE_LIMIT_MAX_BUCKETS) return;
  for (const [ip, entry] of rateLimitBuckets.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.delete(ip);
    }
  }
}

function ensureRateLimitCapacity() {
  while (rateLimitBuckets.size >= RATE_LIMIT_MAX_BUCKETS) {
    const oldestKey = rateLimitBuckets.keys().next().value;
    if (!oldestKey) break;
    rateLimitBuckets.delete(oldestKey);
  }
}

function isRateLimited(ip, now = Date.now()) {
  trimRateLimitBuckets(now);
  const current = rateLimitBuckets.get(ip);
  if (!current || now - current.windowStart > RATE_LIMIT_WINDOW_MS) {
    ensureRateLimitCapacity();
    rateLimitBuckets.set(ip, { windowStart: now, count: 1 });
    return false;
  }

  current.count += 1;
  if (current.count > RATE_LIMIT_MAX_REQUESTS) return true;
  return false;
}

function isSameOriginRequest(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").trim();
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host;
  } catch {
    return false;
  }
}

function isAllowedFetchSite(req) {
  const site = String(req.headers["sec-fetch-site"] || "").trim().toLowerCase();
  if (!site) return true;
  return site === "same-origin" || site === "same-site" || site === "none";
}

function isLikelyJson(req) {
  const type = String(req.headers["content-type"] || "").toLowerCase();
  return type.includes("application/json");
}

function isValidIsoDate(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  return !Number.isNaN(Date.parse(value));
}

function isReasonableTimestamp(value, now = Date.now()) {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return false;
  if (now - ts > MAX_EVENT_AGE_MS) return false;
  if (ts - now > MAX_EVENT_FUTURE_SKEW_MS) return false;
  return true;
}

function isValidPayloadShape(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (!payload.message || typeof payload.message !== "string") return false;
  if (!isValidIsoDate(payload.timestamp)) return false;
  return true;
}

function setResponseSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
}

export default function handler(req, res) {
  setResponseSecurityHeaders(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!isSameOriginRequest(req)) {
    return res.status(403).json({ ok: false, error: "Cross-origin request denied" });
  }
  if (!isAllowedFetchSite(req)) {
    return res.status(403).json({ ok: false, error: "Cross-site request denied" });
  }

  if (!isLikelyJson(req)) {
    return res.status(415).json({ ok: false, error: "Unsupported content type" });
  }

  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: "Payload too large" });
  }

  const payload = readPayload(req);
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ ok: false, error: "Invalid JSON payload" });
  }
  if (getBodyBytes(req.body) > MAX_BODY_BYTES || getBodyBytes(payload) > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: "Payload too large" });
  }
  if (!isValidPayloadShape(payload)) {
    return res.status(422).json({ ok: false, error: "Invalid payload format" });
  }
  if (!isReasonableTimestamp(payload.timestamp)) {
    return res.status(422).json({ ok: false, error: "Timestamp outside accepted range" });
  }

  const event = {
    timestamp: toSafeString(payload.timestamp, new Date().toISOString(), 64),
    message: toSafeString(payload.message, "Unknown runtime error", 500),
    name: toSafeString(payload.name, "Error", 120),
    appVersion: toSafeString(payload.appVersion || "unknown", "unknown", 80),
    href: toSafeString(payload.href || "", "", 512),
    stack: toSafeString(payload.stack || "", "", 1800),
    context: normalizeContext(payload.context),
    sourceIp: toSafeString(clientIp, "unknown", 80),
  };

  // Server-side logging is useful for triage and still keeps frontend CSP strict.
  console.error("[runtime-error]", JSON.stringify(event));
  return res.status(204).end();
}

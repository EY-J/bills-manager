import {
  findUserByEmail,
  getStoreMode,
  isPersistentStoreConfigured,
  loadUserBills,
  saveUserBills,
} from "./_lib/accountStore.js";
import { getSessionFromRequest } from "./_lib/accountSession.js";
import { Buffer } from "node:buffer";
import process from "node:process";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const RATE_LIMIT_MAX_BUCKETS = 1500;
const rateLimitBuckets = new Map();

function setResponseSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
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
  return current.count > RATE_LIMIT_MAX_REQUESTS;
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
    if (typeof value === "string") return Buffer.byteLength(value, "utf8");
    if (typeof value === "object") return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return MAX_BODY_BYTES + 1;
  }
  return 0;
}

async function resolveAuthedUser(req) {
  const session = getSessionFromRequest(req);
  if (!session) return null;
  const user = await findUserByEmail(session.email);
  if (!user || String(user.id || "") !== session.uid) return null;
  return user;
}

function validateSyncPayload(payload) {
  if (!payload || typeof payload !== "object") return "Payload is required.";
  if (payload.app !== "bills-manager") return "Invalid app payload.";
  if (!payload.data || typeof payload.data !== "object") return "Invalid data payload.";
  if (!Array.isArray(payload.data.bills)) return "Bills data is invalid.";
  if (typeof payload.checksum !== "string" || !payload.checksum.trim()) {
    return "Checksum is required.";
  }
  return null;
}

export default async function handler(req, res) {
  setResponseSecurityHeaders(res);
  const storeMode = getStoreMode();

  if (!isPersistentStoreConfigured() && process.env.NODE_ENV === "production") {
    return res.status(503).json({
      ok: false,
      error: "Cloud account storage is not configured.",
      storageMode: storeMode,
    });
  }

  if (req.method !== "GET" && req.method !== "PUT") {
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!isSameOriginRequest(req)) {
    return res.status(403).json({ ok: false, error: "Cross-origin request denied" });
  }
  if (!isAllowedFetchSite(req)) {
    return res.status(403).json({ ok: false, error: "Cross-site request denied" });
  }

  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
  }

  const user = await resolveAuthedUser(req);
  if (!user) {
    return res.status(401).json({ ok: false, error: "Unauthorized." });
  }

  if (req.method === "GET") {
    try {
      const record = await loadUserBills(user.id);
      return res.status(200).json({
        ok: true,
        storageMode: storeMode,
        updatedAt: record?.updatedAt || null,
        payload: record?.payload || null,
      });
    } catch {
      return res.status(500).json({
        ok: false,
        error: "Could not load account data.",
        storageMode: storeMode,
      });
    }
  }

  if (!isLikelyJson(req)) {
    return res.status(415).json({ ok: false, error: "Unsupported content type" });
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: "Payload too large" });
  }

  const body = readPayload(req);
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "Invalid JSON payload" });
  }
  if (getBodyBytes(body) > MAX_BODY_BYTES || getBodyBytes(req.body) > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: "Payload too large" });
  }

  const payload = body.payload;
  const payloadError = validateSyncPayload(payload);
  if (payloadError) {
    return res.status(422).json({ ok: false, error: payloadError });
  }

  let record = null;
  try {
    record = await saveUserBills({
      userId: user.id,
      payload,
    });
  } catch {
    return res.status(500).json({
      ok: false,
      error: "Could not save account data.",
      storageMode: storeMode,
    });
  }

  return res.status(200).json({
    ok: true,
    storageMode: storeMode,
    updatedAt: record.updatedAt,
  });
}

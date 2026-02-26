import process from "node:process";

const ALERT_CACHE_KEY = "__bills_manager_security_alert_cache_v1__";
const ALERT_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

function getAlertCache() {
  if (!globalThis[ALERT_CACHE_KEY]) {
    globalThis[ALERT_CACHE_KEY] = new Map();
  }
  return globalThis[ALERT_CACHE_KEY];
}

function pruneAlertCache(now = Date.now()) {
  const cache = getAlertCache();
  for (const [key, timestamp] of cache.entries()) {
    if (now - Number(timestamp || 0) > ALERT_DEDUPE_WINDOW_MS) {
      cache.delete(key);
    }
  }
}

function shouldEmitAlert(dedupeKey, now = Date.now()) {
  pruneAlertCache(now);
  const cache = getAlertCache();
  const existing = Number(cache.get(dedupeKey) || 0);
  if (existing > 0 && now - existing <= ALERT_DEDUPE_WINDOW_MS) {
    return false;
  }
  cache.set(dedupeKey, now);
  return true;
}

function sanitizeContext(rawContext) {
  if (!rawContext || typeof rawContext !== "object" || Array.isArray(rawContext)) return {};
  const result = {};
  for (const [key, value] of Object.entries(rawContext).slice(0, 20)) {
    const safeKey = String(key || "").slice(0, 80);
    const safeValue = String(value ?? "").slice(0, 280);
    if (!safeKey) continue;
    result[safeKey] = safeValue;
  }
  return result;
}

function resolveWebhookUrl() {
  const value = String(process.env.SECURITY_ALERT_WEBHOOK_URL || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export async function emitSecurityAlert({
  type = "security-event",
  severity = "warning",
  message = "",
  context = {},
} = {}) {
  const safeType = String(type || "security-event").slice(0, 80);
  const safeSeverity = String(severity || "warning").slice(0, 20);
  const safeMessage = String(message || "").slice(0, 400);
  const safeContext = sanitizeContext(context);
  const dedupeKey = `${safeType}|${safeSeverity}|${safeContext.ip || ""}|${
    safeContext.email || ""
  }|${safeMessage.slice(0, 120)}`;
  if (!shouldEmitAlert(dedupeKey)) return;

  const payload = {
    timestamp: new Date().toISOString(),
    type: safeType,
    severity: safeSeverity,
    message: safeMessage,
    context: safeContext,
  };

  console.warn("[security-alert]", JSON.stringify(payload));
  const webhookUrl = resolveWebhookUrl();
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Ignore external delivery failures.
  }
}


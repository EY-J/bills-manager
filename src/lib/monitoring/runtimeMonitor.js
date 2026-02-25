const ERROR_STORAGE_KEY = "bills_runtime_errors_v1";
const MAX_STORED_ERRORS = 25;
const SEND_WINDOW_MS = 60 * 1000;
const SEND_MAX_PER_WINDOW = 20;
const DEDUPE_WINDOW_MS = 30 * 1000;
const MAX_FINGERPRINTS = 200;
const MAX_MONITOR_TEXT_LENGTH = 4000;

let monitoringInitialized = false;
const sendState = {
  windowStart: 0,
  count: 0,
  fingerprints: new Map(),
};

function getEnvString(key, fallback = "") {
  try {
    const value = import.meta?.env?.[key];
    return typeof value === "string" ? value : fallback;
  } catch {
    return fallback;
  }
}

const REDACTION_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  /\b(token|api[_-]?key|password)\s*[:=]\s*[^,\s"']+/gi,
];

export function sanitizeRuntimeText(value, maxLen = MAX_MONITOR_TEXT_LENGTH) {
  if (value == null) return value;
  let text = String(value);
  for (const pattern of REDACTION_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }
  if (text.length > maxLen) {
    text = `${text.slice(0, maxLen)}...`;
  }
  return text;
}

export function sanitizeRuntimeHref(rawHref) {
  if (!rawHref) return null;
  try {
    const baseHref =
      typeof window !== "undefined" && typeof window.location?.href === "string"
        ? window.location.href
        : "https://local.invalid/";
    const url = new URL(String(rawHref), baseHref);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return sanitizeRuntimeText(rawHref, 512);
  }
}

function sanitizeRuntimeContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return {};
  const entries = Object.entries(context).slice(0, 20);
  const result = {};
  for (const [rawKey, rawValue] of entries) {
    const key = sanitizeRuntimeText(rawKey, 80);
    result[key] = sanitizeRuntimeText(rawValue, 500);
  }
  return result;
}

export function resolveMonitoringEndpoint(rawEndpoint, currentHref = "") {
  const endpoint = typeof rawEndpoint === "string" ? rawEndpoint.trim() : "";
  if (!endpoint) return "";

  const hasWindowHref =
    typeof window !== "undefined" &&
    typeof window.location?.href === "string" &&
    window.location.href.trim();
  const baseHref = (currentHref || (hasWindowHref ? window.location.href : "")).trim();

  if (!baseHref) {
    // Without a browser URL context, only allow local-root relative paths.
    return endpoint.startsWith("/") ? endpoint : "";
  }

  try {
    const current = new URL(baseHref);
    const target = new URL(endpoint, current);
    if (!["http:", "https:"].includes(target.protocol)) return "";
    if (target.origin !== current.origin) return "";
    return target.toString();
  } catch {
    return "";
  }
}

function getMonitoringEndpoint() {
  const raw = getEnvString("VITE_ERROR_REPORT_ENDPOINT", "");
  return resolveMonitoringEndpoint(raw);
}

function getAppVersion() {
  return getEnvString("VITE_APP_VERSION", "").trim() || null;
}

function normalizeError(errorLike) {
  if (errorLike instanceof Error) return errorLike;
  if (typeof errorLike === "string") return new Error(errorLike);
  try {
    return new Error(JSON.stringify(errorLike));
  } catch {
    return new Error(String(errorLike ?? "Unknown runtime error"));
  }
}

function readStoredErrors() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(ERROR_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredErrors(entries) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(ERROR_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage failures; monitoring should never crash the app.
  }
}

function buildErrorPayload(errorLike, context = {}) {
  const err = normalizeError(errorLike);
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
    message: sanitizeRuntimeText(err.message || "Unknown error", 500),
    name: sanitizeRuntimeText(err.name || "Error", 120),
    stack: sanitizeRuntimeText(err.stack || "", 2000) || null,
    context: sanitizeRuntimeContext(context),
    href: sanitizeRuntimeHref(
      typeof window !== "undefined" ? window.location?.href || null : null
    ),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent || null : null,
    appVersion: getAppVersion(),
  };
}

function buildFingerprint(payload) {
  const source = payload?.context?.source || "";
  const message = payload?.message || "";
  const name = payload?.name || "";
  const href = payload?.href || "";
  return `${name}|${message}|${source}|${href}`;
}

function trimFingerprints(now) {
  for (const [fingerprint, seenAt] of sendState.fingerprints.entries()) {
    if (now - seenAt > DEDUPE_WINDOW_MS) {
      sendState.fingerprints.delete(fingerprint);
    }
  }
  while (sendState.fingerprints.size > MAX_FINGERPRINTS) {
    const oldest = sendState.fingerprints.keys().next().value;
    if (!oldest) break;
    sendState.fingerprints.delete(oldest);
  }
}

export function shouldSendRuntimePayload(payload, now = Date.now()) {
  trimFingerprints(now);

  if (!sendState.windowStart || now - sendState.windowStart > SEND_WINDOW_MS) {
    sendState.windowStart = now;
    sendState.count = 0;
  }

  if (sendState.count >= SEND_MAX_PER_WINDOW) return false;

  const fingerprint = buildFingerprint(payload);
  const lastSeenAt = sendState.fingerprints.get(fingerprint);
  if (lastSeenAt && now - lastSeenAt <= DEDUPE_WINDOW_MS) {
    return false;
  }

  sendState.count += 1;
  sendState.fingerprints.set(fingerprint, now);
  return true;
}

export function resetRuntimeMonitorStateForTests() {
  monitoringInitialized = false;
  sendState.windowStart = 0;
  sendState.count = 0;
  sendState.fingerprints.clear();
}

function storeError(payload) {
  const existing = readStoredErrors();
  const next = [payload, ...existing].slice(0, MAX_STORED_ERRORS);
  writeStoredErrors(next);
}

function sendErrorToEndpoint(payload) {
  const endpoint = getMonitoringEndpoint();
  if (!endpoint) return;
  if (!shouldSendRuntimePayload(payload)) return;

  const body = JSON.stringify(payload);

  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const blob = new Blob([body], { type: "application/json" });
      const accepted = navigator.sendBeacon(endpoint, blob);
      if (accepted) return;
    }
  } catch {
    // Fall through to fetch.
  }

  try {
    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      mode: "same-origin",
    }).catch(() => {});
  } catch {
    // Ignore request setup failures.
  }
}

export function captureRuntimeError(errorLike, context = {}) {
  const payload = buildErrorPayload(errorLike, context);
  storeError(payload);
  sendErrorToEndpoint(payload);
  return payload;
}

export function initRuntimeMonitoring() {
  if (monitoringInitialized || typeof window === "undefined") return;
  monitoringInitialized = true;

  window.addEventListener("error", (event) => {
    captureRuntimeError(event.error || event.message, {
      source: "window.error",
      filename: event.filename || null,
      lineno: Number(event.lineno || 0) || null,
      colno: Number(event.colno || 0) || null,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    captureRuntimeError(event.reason, {
      source: "window.unhandledrejection",
    });
  });
}

export function getRuntimeErrorHistory() {
  return readStoredErrors();
}

export function clearRuntimeErrorHistory() {
  writeStoredErrors([]);
}

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";

const SESSION_COOKIE_NAME = "bills_account_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function toBase64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(input) {
  return Buffer.from(String(input || ""), "base64url").toString("utf8");
}

function stableJson(value) {
  return JSON.stringify(value);
}

function getSessionSecret() {
  const configured = String(process.env.AUTH_SESSION_SECRET || "").trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") {
    return "dev-only-session-secret-change-me";
  }
  return "";
}

function signPayload(payloadBase64) {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("AUTH_SESSION_SECRET is required in production.");
  }
  return createHmac("sha256", secret).update(payloadBase64).digest("base64url");
}

function safeCompare(a, b) {
  try {
    const left = Buffer.from(String(a || ""), "utf8");
    const right = Buffer.from(String(b || ""), "utf8");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function hashPassword(password, saltHex = randomBytes(16).toString("hex")) {
  const plain = String(password || "");
  const salt = String(saltHex || "");
  const hash = scryptSync(plain, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, storedHash, storedSalt) {
  const candidate = hashPassword(password, storedSalt).hash;
  return safeCompare(candidate, storedHash);
}

export function createSessionToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    uid: String(user?.id || ""),
    email: String(user?.email || ""),
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const encoded = toBase64Url(stableJson(payload));
  const signature = signPayload(encoded);
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token) {
  const text = String(token || "").trim();
  if (!text.includes(".")) return null;
  const [encodedPayload, signature] = text.split(".", 2);
  if (!encodedPayload || !signature) return null;

  const expectedSig = signPayload(encodedPayload);
  if (!safeCompare(expectedSig, signature)) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload !== "object") return null;
    if (typeof payload.uid !== "string" || payload.uid.length < 10) return null;
    if (typeof payload.email !== "string" || payload.email.length < 3) return null;
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now) return null;
    return {
      uid: payload.uid,
      email: payload.email,
      exp: Number(payload.exp),
    };
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const raw = String(cookieHeader || "");
  if (!raw) return {};
  return raw.split(";").reduce((acc, piece) => {
    const [k, ...rest] = piece.trim().split("=");
    if (!k) return acc;
    acc[k] = rest.join("=");
    return acc;
  }, {});
}

function shouldUseSecureCookie(req) {
  const proto = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
  if (proto === "https") return true;
  if (proto === "http") return false;
  return process.env.NODE_ENV === "production";
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req?.headers?.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token);
}

export function setSessionCookie(res, token, req) {
  const secure = shouldUseSecureCookie(req);
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) cookieParts.push("Secure");
  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

export function clearSessionCookie(res, req) {
  const secure = shouldUseSecureCookie(req);
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) cookieParts.push("Secure");
  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

import {
  createUser,
  findUserByEmail,
  getStoreMode,
  isPersistentStoreConfigured,
  storeDelete,
  storeGetJson,
  storeSetJson,
  updateUserPassword,
} from "./_lib/accountStore.js";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import {
  clearSessionCookie,
  createSessionToken,
  getSessionFromRequest,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "./_lib/accountSession.js";
import {
  sendPasswordResetLinkEmail,
  sendSignupVerificationEmail,
  shouldExposeAuthDebugArtifacts,
} from "./_lib/accountEmail.js";

const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 45;
const RATE_LIMIT_MAX_BUCKETS = 1200;
const rateLimitBuckets = new Map();
const SIGNUP_CODE_TTL_MS = 10 * 60 * 1000;
const SIGNUP_CODE_RESEND_COOLDOWN_MS = 30 * 1000;
const SIGNUP_CODE_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const PASSWORD_RESET_RESEND_COOLDOWN_MS = 30 * 1000;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_MAX_ATTEMPTS = 6;
const LOGIN_FAILURE_LOCK_MS = 5 * 60 * 1000;
const GENERIC_LOGIN_ERROR_MESSAGE = "Invalid email or password.";

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

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validateEmail(email) {
  const value = normalizeEmail(email);
  if (!value) return { ok: false, reason: "Email is required." };
  if (value.length > 160) return { ok: false, reason: "Email is too long." };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    return { ok: false, reason: "Enter a valid email address." };
  }
  return { ok: true, value };
}

function validatePassword(password) {
  const value = String(password || "");
  if (!value) return { ok: false, reason: "Password is required." };
  if (value.length < 8) return { ok: false, reason: "Password must be at least 8 characters." };
  if (value.length > 128) return { ok: false, reason: "Password is too long." };
  return { ok: true, value };
}

function validateStrongPassword(password) {
  const basicCheck = validatePassword(password);
  if (!basicCheck.ok) return basicCheck;

  const value = basicCheck.value;
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasNumber = /\d/.test(value);
  if (!hasLower || !hasUpper || !hasNumber) {
    return {
      ok: false,
      reason: "Password must include uppercase, lowercase, and a number.",
    };
  }
  return { ok: true, value };
}

function normalizeVerificationCode(code) {
  return String(code || "").replace(/\D+/g, "").slice(0, 6);
}

function validateVerificationCode(code) {
  const value = normalizeVerificationCode(code);
  if (value.length !== 6) {
    return { ok: false, reason: "Enter the 6-digit verification code." };
  }
  return { ok: true, value };
}

function signupCodeKey(email) {
  return `account:signup:code:${normalizeEmail(email)}`;
}

function passwordResetThrottleKey(email) {
  return `account:password-reset:throttle:${normalizeEmail(email)}`;
}

function passwordResetTokenKey(tokenHash) {
  return `account:password-reset:token:${String(tokenHash || "")}`;
}

function loginFailureKey(email) {
  return `account:login:failure:${normalizeEmail(email)}`;
}

function secondsFromMs(ms) {
  return Math.max(1, Math.ceil(Math.max(0, Number(ms) || 0) / 1000));
}

async function getLoginFailureState(email, now = Date.now()) {
  const key = loginFailureKey(email);
  const stored = await storeGetJson(key);
  if (!stored || typeof stored !== "object") {
    return {
      key,
      firstFailedAt: 0,
      failureCount: 0,
      blockedUntil: 0,
    };
  }

  const firstFailedAt = Number(stored.firstFailedAt || 0);
  const failureCount = Math.max(0, Number(stored.failureCount || 0));
  const blockedUntil = Number(stored.blockedUntil || 0);
  const isBlocked = Number.isFinite(blockedUntil) && blockedUntil > now;

  if (isBlocked) {
    return {
      key,
      firstFailedAt,
      failureCount,
      blockedUntil,
    };
  }

  const withinWindow = Number.isFinite(firstFailedAt) && now - firstFailedAt <= LOGIN_FAILURE_WINDOW_MS;
  if (!withinWindow || failureCount <= 0) {
    await storeDelete(key);
    return {
      key,
      firstFailedAt: 0,
      failureCount: 0,
      blockedUntil: 0,
    };
  }

  return {
    key,
    firstFailedAt,
    failureCount,
    blockedUntil: 0,
  };
}

async function recordLoginFailure(email, now = Date.now()) {
  const state = await getLoginFailureState(email, now);
  const withinWindow = state.firstFailedAt > 0 && now - state.firstFailedAt <= LOGIN_FAILURE_WINDOW_MS;
  const firstFailedAt = withinWindow ? state.firstFailedAt : now;
  const failureCount = withinWindow ? state.failureCount + 1 : 1;

  if (failureCount >= LOGIN_FAILURE_MAX_ATTEMPTS) {
    const blockedUntil = now + LOGIN_FAILURE_LOCK_MS;
    await storeSetJson(state.key, {
      firstFailedAt,
      failureCount,
      blockedUntil,
    });
    return {
      blockedUntil,
      retryAfterSeconds: secondsFromMs(LOGIN_FAILURE_LOCK_MS),
    };
  }

  await storeSetJson(state.key, {
    firstFailedAt,
    failureCount,
    blockedUntil: 0,
  });
  return {
    blockedUntil: 0,
    retryAfterSeconds: 0,
  };
}

async function clearLoginFailureState(email) {
  await storeDelete(loginFailureKey(email));
}

function getVerificationSecret() {
  const explicit = String(process.env.AUTH_VERIFICATION_SECRET || "").trim();
  if (explicit) return explicit;
  const sessionSecret = String(process.env.AUTH_SESSION_SECRET || "").trim();
  if (sessionSecret) return sessionSecret;
  if (process.env.NODE_ENV !== "production") {
    return "dev-only-verification-secret-change-me";
  }
  return "";
}

function hashVerificationCode(email, code) {
  const secret = getVerificationSecret();
  if (!secret) {
    throw new Error("AUTH_VERIFICATION_SECRET is required in production.");
  }
  const payload = `${normalizeEmail(email)}:${normalizeVerificationCode(code)}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function hashPasswordResetToken(token) {
  const secret = getVerificationSecret();
  if (!secret) {
    throw new Error("AUTH_VERIFICATION_SECRET is required in production.");
  }
  const payload = `password-reset-token:${String(token || "").trim()}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function createPasswordResetToken() {
  return randomBytes(32).toString("base64url");
}

function validatePasswordResetToken(token) {
  const value = String(token || "").trim();
  if (!value) {
    return { ok: false, reason: "Reset link is invalid." };
  }
  if (value.length > 240) {
    return { ok: false, reason: "Reset link is invalid." };
  }
  const validFormat = /^[A-Za-z0-9_-]+$/.test(value);
  if (!validFormat) {
    return { ok: false, reason: "Reset link is invalid." };
  }
  return { ok: true, value };
}

function normalizeOrigin(rawOrigin) {
  const value = String(rawOrigin || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

function resolveRequestOrigin(req) {
  const configured = normalizeOrigin(process.env.PUBLIC_APP_ORIGIN);
  if (configured) return configured;

  const protoHeader = String(req.headers["x-forwarded-proto"] || "").split(",")[0]?.trim();
  const proto =
    protoHeader === "https" || protoHeader === "http"
      ? protoHeader
      : process.env.NODE_ENV === "production"
        ? "https"
        : "http";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").trim();
  if (!host) return "";
  return `${proto}://${host}`;
}

function buildPasswordResetUrl(req, token) {
  const origin = resolveRequestOrigin(req);
  if (!origin) return "";
  const url = new URL(origin);
  url.pathname = "/";
  url.searchParams.set("resetToken", String(token || "").trim());
  return url.toString();
}

function safeHashEqual(left, right) {
  try {
    const a = Buffer.from(String(left || ""), "utf8");
    const b = Buffer.from(String(right || ""), "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
  };
}

function issueSessionOrFail(res, req, user) {
  try {
    const token = createSessionToken(user);
    setSessionCookie(res, token, req);
    return true;
  } catch {
    res.status(503).json({
      ok: false,
      error: "Session configuration is missing.",
      storageMode: getStoreMode(),
    });
    return false;
  }
}

function isCloudStorageReady() {
  if (isPersistentStoreConfigured()) return true;
  return process.env.NODE_ENV !== "production";
}

async function resolveSessionUser(req) {
  const session = getSessionFromRequest(req);
  if (!session) return null;
  const user = await findUserByEmail(session.email);
  if (!user || String(user.id || "") !== session.uid) return null;
  return publicUser(user);
}

export default async function handler(req, res) {
  setResponseSecurityHeaders(res);
  const storeMode = getStoreMode();
  const exposeAuthDebugArtifacts = shouldExposeAuthDebugArtifacts();

  if (!isCloudStorageReady()) {
    return res.status(503).json({
      ok: false,
      error: "Cloud account storage is not configured.",
      storageMode: storeMode,
    });
  }

  if (req.method === "GET") {
    const user = await resolveSessionUser(req);
    return res.status(200).json({
      ok: true,
      user,
      storageMode: storeMode,
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
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

  const contentLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: "Payload too large" });
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
  }

  const payload = readPayload(req);
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ ok: false, error: "Invalid JSON payload" });
  }
  if (getBodyBytes(payload) > MAX_BODY_BYTES || getBodyBytes(req.body) > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: "Payload too large" });
  }

  let action = String(payload.action || "").trim().toLowerCase();
  if (action === "create-account" || action === "register") {
    action = "signup";
  }
  if (
    action === "forgot-password" ||
    action === "request-reset-code" ||
    action === "request-password-reset-code"
  ) {
    action = "request-password-reset-link";
  }
  if (action === "complete-reset" || action === "reset-password") {
    action = "complete-password-reset-token";
  }
  if (action === "complete-password-reset") {
    // Backward compatible alias; now expects reset token.
    action = "complete-password-reset-token";
  }

  if (action === "logout") {
    clearSessionCookie(res, req);
    return res.status(200).json({ ok: true, user: null, storageMode: storeMode });
  }

  if (
    action !== "signup" &&
    action !== "request-signup-code" &&
    action !== "complete-signup" &&
    action !== "request-password-reset-link" &&
    action !== "complete-password-reset-token" &&
    action !== "login"
  ) {
    return res.status(422).json({ ok: false, error: "Unsupported auth action." });
  }

  const actionNeedsEmail =
    action === "signup" ||
    action === "request-signup-code" ||
    action === "complete-signup" ||
    action === "request-password-reset-link" ||
    action === "login";

  let email = "";
  if (actionNeedsEmail) {
    const emailCheck = validateEmail(payload.email);
    if (!emailCheck.ok) {
      return res.status(422).json({ ok: false, error: emailCheck.reason });
    }
    email = emailCheck.value;
  }

  if (action === "request-signup-code") {
    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ ok: false, error: "Email is already registered." });
    }

    const now = Date.now();
    const codeKey = signupCodeKey(email);
    const pending = await storeGetJson(codeKey);
    if (
      pending &&
      Number.isFinite(Number(pending.sentAt)) &&
      now - Number(pending.sentAt) < SIGNUP_CODE_RESEND_COOLDOWN_MS &&
      Number(pending.expiresAt || 0) > now
    ) {
      const waitSeconds = Math.ceil(
        (SIGNUP_CODE_RESEND_COOLDOWN_MS - (now - Number(pending.sentAt))) / 1000
      );
      res.setHeader("Retry-After", String(Math.max(waitSeconds, 1)));
      return res.status(429).json({
        ok: false,
        error: `Please wait ${Math.max(waitSeconds, 1)}s before requesting another link.`,
      });
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const codeHash = hashVerificationCode(email, code);
    await storeSetJson(codeKey, {
      email,
      codeHash,
      sentAt: now,
      expiresAt: now + SIGNUP_CODE_TTL_MS,
      attempts: 0,
    });

    const emailResult = await sendSignupVerificationEmail({
      toEmail: email,
      code,
      ttlMinutes: Math.round(SIGNUP_CODE_TTL_MS / 60000),
    });
    if (!emailResult.ok) {
      await storeDelete(codeKey);
      return res.status(503).json({
        ok: false,
        error: emailResult.error || "Could not send verification email.",
      });
    }

    const response = {
      ok: true,
      verificationRequired: true,
      expiresInSeconds: Math.floor(SIGNUP_CODE_TTL_MS / 1000),
      storageMode: storeMode,
    };
    if (emailResult.debugCode && exposeAuthDebugArtifacts) {
      response.debugCode = emailResult.debugCode;
    }
    return res.status(200).json(response);
  }

  if (action === "signup") {
    const passwordCheck = validateStrongPassword(payload.password);
    if (!passwordCheck.ok) {
      return res.status(422).json({ ok: false, error: passwordCheck.reason });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ ok: false, error: "Email is already registered." });
    }

    const { hash, salt } = hashPassword(passwordCheck.value);
    const user = await createUser({
      email,
      passwordHash: hash,
      passwordSalt: salt,
    });
    await storeDelete(signupCodeKey(email));
    if (!issueSessionOrFail(res, req, user)) return;
    return res.status(200).json({
      ok: true,
      user: publicUser(user),
      storageMode: storeMode,
    });
  }

  if (action === "request-password-reset-link") {
    const existing = await findUserByEmail(email);
    if (!existing) {
      // Return success regardless to avoid account email enumeration.
      return res.status(200).json({
        ok: true,
        linkSent: true,
        expiresInSeconds: Math.floor(PASSWORD_RESET_TOKEN_TTL_MS / 1000),
        storageMode: storeMode,
      });
    }

    const now = Date.now();
    const throttleKey = passwordResetThrottleKey(email);
    const pending = await storeGetJson(throttleKey);
    if (
      pending &&
      Number.isFinite(Number(pending.sentAt)) &&
      now - Number(pending.sentAt) < PASSWORD_RESET_RESEND_COOLDOWN_MS &&
      Number(pending.expiresAt || 0) > now
    ) {
      const waitSeconds = Math.ceil(
        (PASSWORD_RESET_RESEND_COOLDOWN_MS - (now - Number(pending.sentAt))) / 1000
      );
      res.setHeader("Retry-After", String(Math.max(waitSeconds, 1)));
      return res.status(429).json({
        ok: false,
        error: `Please wait ${Math.max(waitSeconds, 1)}s before requesting another code.`,
      });
    }

    if (pending?.tokenHash) {
      await storeDelete(passwordResetTokenKey(pending.tokenHash));
    }

    const token = createPasswordResetToken();
    const tokenHash = hashPasswordResetToken(token);
    await storeSetJson(passwordResetTokenKey(tokenHash), {
      email,
      createdAt: now,
      expiresAt: now + PASSWORD_RESET_TOKEN_TTL_MS,
    });
    await storeSetJson(throttleKey, {
      sentAt: now,
      expiresAt: now + PASSWORD_RESET_TOKEN_TTL_MS,
      tokenHash,
    });

    const resetUrl = buildPasswordResetUrl(req, token);
    if (!resetUrl) {
      await storeDelete(passwordResetTokenKey(tokenHash));
      await storeDelete(throttleKey);
      return res.status(503).json({
        ok: false,
        error: "Could not build password reset link.",
      });
    }

    const emailResult = await sendPasswordResetLinkEmail({
      toEmail: email,
      resetUrl,
      ttlMinutes: Math.round(PASSWORD_RESET_TOKEN_TTL_MS / 60000),
    });
    if (!emailResult.ok) {
      await storeDelete(passwordResetTokenKey(tokenHash));
      await storeDelete(throttleKey);
      return res.status(503).json({
        ok: false,
        error: emailResult.error || "Could not send password reset email.",
      });
    }

    const response = {
      ok: true,
      linkSent: true,
      expiresInSeconds: Math.floor(PASSWORD_RESET_TOKEN_TTL_MS / 1000),
      storageMode: storeMode,
    };
    if (emailResult.debugResetLink && exposeAuthDebugArtifacts) {
      response.debugResetLink = emailResult.debugResetLink;
    }
    return res.status(200).json(response);
  }

  if (action === "complete-signup") {
    const passwordCheck = validateStrongPassword(payload.password);
    if (!passwordCheck.ok) {
      return res.status(422).json({ ok: false, error: passwordCheck.reason });
    }
    const codeCheck = validateVerificationCode(payload.code);
    if (!codeCheck.ok) {
      return res.status(422).json({ ok: false, error: codeCheck.reason });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ ok: false, error: "Email is already registered." });
    }

    const now = Date.now();
    const codeKey = signupCodeKey(email);
    const pending = await storeGetJson(codeKey);
    if (!pending || normalizeEmail(pending.email) !== email) {
      return res.status(400).json({
        ok: false,
        error: "Verification code was not requested for this email.",
      });
    }
    if (Number(pending.expiresAt || 0) <= now) {
      await storeDelete(codeKey);
      return res.status(410).json({
        ok: false,
        error: "Verification code has expired. Request a new code.",
      });
    }

    const attempts = Math.max(0, Number(pending.attempts || 0));
    if (attempts >= SIGNUP_CODE_MAX_ATTEMPTS) {
      await storeDelete(codeKey);
      return res.status(429).json({
        ok: false,
        error: "Too many invalid attempts. Request a new verification code.",
      });
    }

    const expectedHash = String(pending.codeHash || "");
    const receivedHash = hashVerificationCode(email, codeCheck.value);
    if (!safeHashEqual(expectedHash, receivedHash)) {
      const nextAttempts = attempts + 1;
      if (nextAttempts >= SIGNUP_CODE_MAX_ATTEMPTS) {
        await storeDelete(codeKey);
      } else {
        await storeSetJson(codeKey, {
          ...pending,
          attempts: nextAttempts,
        });
      }
      return res.status(401).json({
        ok: false,
        error: "Invalid verification code.",
      });
    }

    const { hash, salt } = hashPassword(passwordCheck.value);
    const user = await createUser({
      email,
      passwordHash: hash,
      passwordSalt: salt,
    });
    await storeDelete(codeKey);
    if (!issueSessionOrFail(res, req, user)) return;
    return res.status(200).json({
      ok: true,
      user: publicUser(user),
      storageMode: storeMode,
    });
  }

  if (action === "complete-password-reset-token") {
    const tokenCheck = validatePasswordResetToken(payload.token);
    if (!tokenCheck.ok) {
      return res.status(422).json({ ok: false, error: tokenCheck.reason });
    }
    const passwordCheck = validateStrongPassword(payload.password);
    if (!passwordCheck.ok) {
      return res.status(422).json({ ok: false, error: passwordCheck.reason });
    }

    const now = Date.now();
    const tokenHash = hashPasswordResetToken(tokenCheck.value);
    const tokenKey = passwordResetTokenKey(tokenHash);
    const pending = await storeGetJson(tokenKey);
    if (!pending) {
      return res.status(400).json({
        ok: false,
        error: "Reset link is invalid or has already been used.",
      });
    }
    if (Number(pending.expiresAt || 0) <= now) {
      await storeDelete(tokenKey);
      return res.status(410).json({
        ok: false,
        error: "Reset link has expired. Request a new link.",
      });
    }

    const email = normalizeEmail(pending.email);
    const existing = await findUserByEmail(email);
    if (!existing) {
      await storeDelete(tokenKey);
      return res.status(400).json({
        ok: false,
        error: "Reset link is invalid or has already been used.",
      });
    }

    const { hash, salt } = hashPassword(passwordCheck.value);
    const user = await updateUserPassword({
      email,
      passwordHash: hash,
      passwordSalt: salt,
    });
    await storeDelete(tokenKey);
    await storeDelete(passwordResetThrottleKey(email));
    if (!user) {
      return res.status(400).json({
        ok: false,
        error: "Reset link is invalid or has already been used.",
      });
    }
    if (!issueSessionOrFail(res, req, user)) return;
    return res.status(200).json({
      ok: true,
      user: publicUser(user),
      storageMode: storeMode,
    });
  }

  const passwordCheck = validatePassword(payload.password);
  if (!passwordCheck.ok) {
    return res.status(422).json({ ok: false, error: passwordCheck.reason });
  }
  const password = passwordCheck.value;

  const now = Date.now();
  const loginFailureState = await getLoginFailureState(email, now);
  if (loginFailureState.blockedUntil > now) {
    const retryAfterSeconds = secondsFromMs(loginFailureState.blockedUntil - now);
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      ok: false,
      error: `Too many sign-in attempts. Try again in ${retryAfterSeconds}s.`,
    });
  }

  const user = await findUserByEmail(email);
  const validPassword =
    Boolean(user) && verifyPassword(password, user.passwordHash, user.passwordSalt);
  if (!validPassword) {
    const failureState = await recordLoginFailure(email, now);
    if (failureState.blockedUntil > now) {
      const retryAfterSeconds = secondsFromMs(failureState.blockedUntil - now);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        ok: false,
        error: `Too many sign-in attempts. Try again in ${retryAfterSeconds}s.`,
      });
    }
    return res.status(401).json({ ok: false, error: GENERIC_LOGIN_ERROR_MESSAGE });
  }

  await clearLoginFailureState(email);
  if (!issueSessionOrFail(res, req, user)) return;
  return res.status(200).json({
    ok: true,
    user: publicUser(user),
    storageMode: storeMode,
  });
}

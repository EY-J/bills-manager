const OFFLINE_USERS_KEY = "bills_offline_account_users_v1";
const OFFLINE_SESSION_KEY = "bills_offline_account_session_v1";
const OFFLINE_RESET_TOKENS_KEY = "bills_offline_account_reset_tokens_v1";
const OFFLINE_SYNC_PREFIX = "bills_offline_account_sync_v1:";
const OFFLINE_STORAGE_MODE = "offline-local";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const RESET_TOKEN_TTL_SECONDS = 60 * 30; // 30 minutes

function getLocalStorageOrThrow() {
  const storage = globalThis?.localStorage;
  if (!storage) {
    throw makeOfflineError("Account storage is unavailable on this device.", 503);
  }
  return storage;
}

function makeOfflineError(message, status = 500, extra = {}) {
  const error = new Error(String(message || "Request failed."));
  error.status = Number(status);
  Object.assign(error, extra);
  return error;
}

function parseJsonSafe(raw, fallback) {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function randomId() {
  if (typeof globalThis?.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `offline_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readUsers() {
  const storage = getLocalStorageOrThrow();
  const parsed = parseJsonSafe(storage.getItem(OFFLINE_USERS_KEY), {});
  if (!parsed || typeof parsed !== "object") return {};
  return parsed;
}

function writeUsers(users) {
  const storage = getLocalStorageOrThrow();
  storage.setItem(OFFLINE_USERS_KEY, JSON.stringify(users));
}

function readResetTokens() {
  const storage = getLocalStorageOrThrow();
  const parsed = parseJsonSafe(storage.getItem(OFFLINE_RESET_TOKENS_KEY), {});
  if (!parsed || typeof parsed !== "object") return {};
  return parsed;
}

function writeResetTokens(tokens) {
  const storage = getLocalStorageOrThrow();
  storage.setItem(OFFLINE_RESET_TOKENS_KEY, JSON.stringify(tokens));
}

function writeSession(user) {
  const storage = getLocalStorageOrThrow();
  const session = {
    uid: String(user?.id || ""),
    email: String(user?.email || ""),
    exp: nowEpochSeconds() + SESSION_TTL_SECONDS,
  };
  storage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(session));
  return session;
}

function clearSession() {
  const storage = getLocalStorageOrThrow();
  storage.removeItem(OFFLINE_SESSION_KEY);
}

function readSession() {
  const storage = getLocalStorageOrThrow();
  const session = parseJsonSafe(storage.getItem(OFFLINE_SESSION_KEY), null);
  if (!session || typeof session !== "object") return null;
  if (Number(session.exp || 0) <= nowEpochSeconds()) {
    storage.removeItem(OFFLINE_SESSION_KEY);
    return null;
  }
  return session;
}

function ensurePasswordPolicy(password) {
  const value = String(password || "");
  if (value.length < 8) {
    throw makeOfflineError("Password must be at least 8 characters.", 422);
  }
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasNumber = /\d/.test(value);
  if (!hasLower || !hasUpper || !hasNumber) {
    throw makeOfflineError("Password must include uppercase, lowercase, and a number.", 422);
  }
}

function ensureValidEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    throw makeOfflineError("Email is required.", 422);
  }
  if (normalized.length > 160) {
    throw makeOfflineError("Email is too long.", 422);
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalized)) {
    throw makeOfflineError("Enter a valid email address.", 422);
  }
  return normalized;
}

function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i += 1) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ""));
}

function getCryptoSubtleOrThrow() {
  const subtle = globalThis?.crypto?.subtle;
  if (!subtle) {
    throw makeOfflineError("Secure auth is unavailable in this browser.", 503);
  }
  return subtle;
}

async function hashPasswordWithSalt(password, saltBytes) {
  const subtle = getCryptoSubtleOrThrow();
  const key = await subtle.importKey("raw", textBytes(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations: 120000,
    },
    key,
    256
  );
  return bytesToBase64(bits);
}

async function buildPasswordRecord(password) {
  getCryptoSubtleOrThrow();
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  const hash = await hashPasswordWithSalt(password, salt);
  return {
    hash,
    salt: bytesToBase64(salt),
    algorithm: "pbkdf2-sha256-v1",
    iterations: 120000,
  };
}

async function verifyPassword(password, passwordRecord) {
  const hash = String(passwordRecord?.hash || "");
  const salt = String(passwordRecord?.salt || "");
  if (!hash || !salt) return false;
  try {
    const computed = await hashPasswordWithSalt(password, base64ToBytes(salt));
    return computed === hash;
  } catch {
    return false;
  }
}

function toPublicUser(user) {
  return {
    id: String(user?.id || ""),
    email: String(user?.email || ""),
  };
}

export async function getOfflineAccountSession() {
  const session = readSession();
  if (!session) {
    return { ok: true, user: null, storageMode: OFFLINE_STORAGE_MODE };
  }
  const users = readUsers();
  const user = users[normalizeEmail(session.email)];
  if (!user || String(user.id || "") !== String(session.uid || "")) {
    clearSession();
    return { ok: true, user: null, storageMode: OFFLINE_STORAGE_MODE };
  }
  return {
    ok: true,
    user: toPublicUser(user),
    storageMode: OFFLINE_STORAGE_MODE,
  };
}

export function clearOfflineAccountSession() {
  clearSession();
}

export function cacheOfflineSessionUser(user) {
  if (!user || typeof user !== "object") return;
  const id = String(user.id || "").trim();
  const email = normalizeEmail(user.email);
  if (!id || !email) return;
  writeSession({ id, email });
}

export async function createOfflineAccount({ email, password }) {
  const normalized = ensureValidEmail(email);
  ensurePasswordPolicy(password);

  const users = readUsers();
  if (users[normalized]) {
    throw makeOfflineError("Email is already registered.", 409);
  }

  const now = new Date().toISOString();
  const passwordRecord = await buildPasswordRecord(password);
  const user = {
    id: randomId(),
    email: normalized,
    password: passwordRecord,
    createdAt: now,
    updatedAt: now,
  };
  users[normalized] = user;
  writeUsers(users);
  writeSession(user);

  return {
    ok: true,
    user: toPublicUser(user),
    storageMode: OFFLINE_STORAGE_MODE,
  };
}

export async function cacheOfflineAccountCredential({ email, password, user }) {
  const normalized = normalizeEmail(email);
  const plainPassword = String(password || "");
  const userId = String(user?.id || "").trim();
  if (!normalized || !plainPassword) return;

  const users = readUsers();
  const existing = users[normalized];
  const passwordRecord = await buildPasswordRecord(plainPassword);
  const now = new Date().toISOString();
  const resolvedId = userId || String(existing?.id || "") || randomId();

  users[normalized] = {
    id: resolvedId,
    email: normalized,
    password: passwordRecord,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  writeUsers(users);
}

export async function loginOfflineAccount({ email, password }) {
  const normalized = ensureValidEmail(email);
  const plainPassword = String(password || "");
  if (!plainPassword) {
    throw makeOfflineError("Password is required.", 422);
  }

  const users = readUsers();
  const user = users[normalized];
  if (!user) {
    throw makeOfflineError("Invalid email or password.", 401);
  }
  const valid = await verifyPassword(plainPassword, user.password);
  if (!valid) {
    throw makeOfflineError("Invalid email or password.", 401);
  }

  writeSession(user);
  return {
    ok: true,
    user: toPublicUser(user),
    storageMode: OFFLINE_STORAGE_MODE,
  };
}

export async function logoutOfflineAccount() {
  clearSession();
  return {
    ok: true,
    user: null,
    storageMode: OFFLINE_STORAGE_MODE,
  };
}

export async function requestOfflinePasswordResetLink(email) {
  const normalized = ensureValidEmail(email);
  const users = readUsers();
  const user = users[normalized];

  if (!user) {
    return {
      ok: true,
      linkSent: true,
      expiresInSeconds: RESET_TOKEN_TTL_SECONDS,
      storageMode: OFFLINE_STORAGE_MODE,
    };
  }

  const token = randomId();
  const expiresAt = nowEpochSeconds() + RESET_TOKEN_TTL_SECONDS;
  const tokens = readResetTokens();
  tokens[token] = {
    email: normalized,
    expiresAt,
  };
  writeResetTokens(tokens);

  const baseOrigin =
    typeof window !== "undefined" && window?.location?.origin
      ? window.location.origin
      : "";
  const debugResetLink = baseOrigin ? `${baseOrigin}/?resetToken=${token}` : "";

  return {
    ok: true,
    linkSent: true,
    expiresInSeconds: RESET_TOKEN_TTL_SECONDS,
    storageMode: OFFLINE_STORAGE_MODE,
    debugResetLink,
  };
}

export async function completeOfflinePasswordReset({ token, password }) {
  const resetToken = String(token || "").trim();
  if (!resetToken) {
    throw makeOfflineError("Reset link is invalid.", 422);
  }
  ensurePasswordPolicy(password);

  const tokens = readResetTokens();
  const tokenRecord = tokens[resetToken];
  if (!tokenRecord) {
    throw makeOfflineError("Reset link is invalid or has already been used.", 400);
  }
  if (Number(tokenRecord.expiresAt || 0) <= nowEpochSeconds()) {
    delete tokens[resetToken];
    writeResetTokens(tokens);
    throw makeOfflineError("Reset link has expired. Request a new link.", 410);
  }

  const normalized = normalizeEmail(tokenRecord.email);
  const users = readUsers();
  const user = users[normalized];
  if (!user) {
    delete tokens[resetToken];
    writeResetTokens(tokens);
    throw makeOfflineError("Reset link is invalid or has already been used.", 400);
  }

  const passwordRecord = await buildPasswordRecord(password);
  users[normalized] = {
    ...user,
    password: passwordRecord,
    updatedAt: new Date().toISOString(),
  };
  writeUsers(users);
  delete tokens[resetToken];
  writeResetTokens(tokens);
  writeSession(users[normalized]);

  return {
    ok: true,
    user: toPublicUser(users[normalized]),
    storageMode: OFFLINE_STORAGE_MODE,
  };
}

function requireOfflineSessionUser() {
  const session = readSession();
  if (!session) {
    throw makeOfflineError("Unauthorized.", 401);
  }
  return session;
}

function offlineSyncKeyForUserId(userId) {
  return `${OFFLINE_SYNC_PREFIX}${String(userId || "")}`;
}

export async function pullOfflineBackup() {
  const session = requireOfflineSessionUser();
  const storage = getLocalStorageOrThrow();
  const record = parseJsonSafe(storage.getItem(offlineSyncKeyForUserId(session.uid)), null);
  return {
    ok: true,
    storageMode: OFFLINE_STORAGE_MODE,
    updatedAt: record?.updatedAt || null,
    payload: record?.payload || null,
  };
}

export async function pushOfflineBackup(payload) {
  const session = requireOfflineSessionUser();
  const storage = getLocalStorageOrThrow();
  const updatedAt = new Date().toISOString();
  storage.setItem(
    offlineSyncKeyForUserId(session.uid),
    JSON.stringify({
      userId: session.uid,
      updatedAt,
      payload,
    })
  );
  return {
    ok: true,
    storageMode: OFFLINE_STORAGE_MODE,
    updatedAt,
  };
}

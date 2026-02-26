import { randomUUID } from "node:crypto";
import { BlobNotFoundError, del as blobDel, get as blobGet, put as blobPut } from "@vercel/blob";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const LOCAL_STORE_CACHE_KEY = "__bills_manager_account_store_local_cache_v1__";
const DEFAULT_BLOB_KEY_PREFIX = "account-store-v1";

function normalizeKvBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function getKvConfig() {
  const url = normalizeKvBaseUrl(process.env.KV_REST_API_URL);
  const token = String(process.env.KV_REST_API_TOKEN || "").trim();
  if (!url || !token) return null;
  return { url, token };
}

function normalizeBlobKeyPrefix(value) {
  const raw = String(value || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return raw || DEFAULT_BLOB_KEY_PREFIX;
}

function getBlobConfig() {
  const token = String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  if (!token) return null;
  const access = String(process.env.ACCOUNT_BLOB_ACCESS || "")
    .trim()
    .toLowerCase();
  return {
    token,
    access: access === "private" ? "private" : "public",
    keyPrefix: normalizeBlobKeyPrefix(process.env.ACCOUNT_BLOB_PREFIX),
  };
}

function blobPathForKey(key, keyPrefix) {
  const encoded = Buffer.from(String(key || ""), "utf8").toString("base64url");
  return `${keyPrefix}/${encoded}.json`;
}

async function readBlobValue(key, blobConfig) {
  const pathname = blobPathForKey(key, blobConfig.keyPrefix);
  const result = await blobGet(pathname, {
    access: blobConfig.access,
    token: blobConfig.token,
    useCache: false,
  });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream).text();
}

async function writeBlobValue(key, rawValue, blobConfig) {
  const pathname = blobPathForKey(key, blobConfig.keyPrefix);
  await blobPut(pathname, rawValue, {
    access: blobConfig.access,
    token: blobConfig.token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
  });
}

async function deleteBlobValue(key, blobConfig) {
  const pathname = blobPathForKey(key, blobConfig.keyPrefix);
  try {
    await blobDel(pathname, {
      token: blobConfig.token,
    });
  } catch (error) {
    if (error instanceof BlobNotFoundError) return;
    throw error;
  }
}

function allowLocalFallback() {
  return process.env.NODE_ENV !== "production";
}

function resolveLocalStorePath() {
  const configured = String(process.env.ACCOUNT_LOCAL_STORE_FILE || "").trim();
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), ".data", "account-store.json");
}

function getLocalStoreCache() {
  if (!globalThis[LOCAL_STORE_CACHE_KEY]) {
    globalThis[LOCAL_STORE_CACHE_KEY] = {
      loaded: false,
      filePath: "",
      map: new Map(),
      loadPromise: null,
      writeChain: Promise.resolve(),
    };
  }
  return globalThis[LOCAL_STORE_CACHE_KEY];
}

function normalizeLocalEntries(payload) {
  if (!payload || typeof payload !== "object") return {};
  const source =
    payload.entries && typeof payload.entries === "object" ? payload.entries : payload;
  const normalized = {};
  for (const [entryKey, entryValue] of Object.entries(source)) {
    if (!entryKey) continue;
    if (typeof entryValue === "string") {
      normalized[entryKey] = entryValue;
      continue;
    }
    try {
      normalized[entryKey] = JSON.stringify(entryValue);
    } catch {
      // Ignore non-serializable payloads.
    }
  }
  return normalized;
}

async function ensureLocalStoreLoaded() {
  const cache = getLocalStoreCache();
  const filePath = resolveLocalStorePath();

  if (cache.loaded && cache.filePath === filePath) {
    return cache;
  }
  if (cache.loadPromise) {
    return cache.loadPromise;
  }

  cache.loadPromise = (async () => {
    let nextMap = new Map();
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      const entries = normalizeLocalEntries(parsed);
      nextMap = new Map(Object.entries(entries));
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : "";
      if (code !== "ENOENT") {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[account-store] Could not read local store file: ${message}`);
      }
    }

    cache.map = nextMap;
    cache.filePath = filePath;
    cache.loaded = true;
    return cache;
  })().finally(() => {
    cache.loadPromise = null;
  });

  return cache.loadPromise;
}

async function persistLocalStore(cache) {
  const filePath = cache.filePath || resolveLocalStorePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: Object.fromEntries(cache.map),
    },
    null,
    2
  );
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  await fs.writeFile(tempPath, payload, "utf8");
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : "";
    if (code === "EPERM" || code === "EACCES") {
      // Windows can briefly lock rename targets. Fallback to direct write.
      await fs.writeFile(filePath, payload, "utf8");
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      return;
    }
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function withLocalStoreWrite(mutator) {
  const cache = await ensureLocalStoreLoaded();
  await mutator(cache.map);

  const previousWrite = cache.writeChain.catch(() => undefined);
  cache.writeChain = previousWrite.then(async () => {
    try {
      await persistLocalStore(cache);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[account-store] Local persistence failed, using in-memory fallback: ${message}`);
    }
  });
  await cache.writeChain;
}

export function getStoreMode() {
  if (getKvConfig()) return "kv";
  if (getBlobConfig()) return "blob";
  return "local";
}

export function isPersistentStoreConfigured() {
  return Boolean(getKvConfig() || getBlobConfig());
}

function parsePipelineResult(raw, expectedLength) {
  if (!Array.isArray(raw)) {
    throw new Error("Invalid KV response.");
  }
  if (raw.length < expectedLength) {
    throw new Error("Incomplete KV response.");
  }
  return raw.map((entry) => {
    if (entry && typeof entry === "object" && "error" in entry && entry.error) {
      throw new Error(String(entry.error));
    }
    if (entry && typeof entry === "object" && "result" in entry) {
      return entry.result;
    }
    return entry;
  });
}

async function runKvPipeline(commands) {
  const config = getKvConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error("Cloud account storage request failed.");
  }

  const payload = await response.json();
  return parsePipelineResult(payload, commands.length);
}

function parseJsonString(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function storeGetJson(key) {
  const normalizedKey = String(key);
  const commands = [["GET", normalizedKey]];
  const kvResult = await runKvPipeline(commands);
  if (kvResult) {
    return parseJsonString(kvResult[0]);
  }

  const blobConfig = getBlobConfig();
  if (blobConfig) {
    const raw = await readBlobValue(normalizedKey, blobConfig);
    return parseJsonString(raw);
  }

  if (!allowLocalFallback()) {
    throw new Error("Cloud account storage is not configured.");
  }

  const cache = await ensureLocalStoreLoaded();
  const raw = cache.map.get(normalizedKey);
  return parseJsonString(raw);
}

export async function storeSetJson(key, value) {
  const normalizedKey = String(key);
  const raw = JSON.stringify(value);
  const commands = [["SET", normalizedKey, raw]];
  const kvResult = await runKvPipeline(commands);
  if (kvResult) return;

  const blobConfig = getBlobConfig();
  if (blobConfig) {
    await writeBlobValue(normalizedKey, raw, blobConfig);
    return;
  }

  if (!allowLocalFallback()) {
    throw new Error("Cloud account storage is not configured.");
  }

  await withLocalStoreWrite((map) => {
    map.set(normalizedKey, raw);
  });
}

export async function storeDelete(key) {
  const normalizedKey = String(key);
  const commands = [["DEL", normalizedKey]];
  const kvResult = await runKvPipeline(commands);
  if (kvResult) return;

  const blobConfig = getBlobConfig();
  if (blobConfig) {
    await deleteBlobValue(normalizedKey, blobConfig);
    return;
  }

  if (!allowLocalFallback()) {
    throw new Error("Cloud account storage is not configured.");
  }

  await withLocalStoreWrite((map) => {
    map.delete(normalizedKey);
  });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function userKeyByEmail(email) {
  return `account:user:email:${normalizeEmail(email)}`;
}

function billsKeyByUserId(userId) {
  return `account:data:user:${String(userId || "").trim()}`;
}

export async function findUserByEmail(email) {
  return storeGetJson(userKeyByEmail(email));
}

export async function createUser({ email, passwordHash, passwordSalt, recoveryCodeHash = "" }) {
  const normalized = normalizeEmail(email);
  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    email: normalized,
    passwordHash: String(passwordHash),
    passwordSalt: String(passwordSalt),
    recoveryCodeHash: String(recoveryCodeHash || ""),
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  await storeSetJson(userKeyByEmail(normalized), user);
  return user;
}

export async function updateUserPassword({ email, passwordHash, passwordSalt }) {
  const normalized = normalizeEmail(email);
  const existing = await findUserByEmail(normalized);
  if (!existing) return null;

  const previousSessionVersion = Math.max(1, Number(existing.sessionVersion || 1));
  const updated = {
    ...existing,
    passwordHash: String(passwordHash),
    passwordSalt: String(passwordSalt),
    sessionVersion: previousSessionVersion + 1,
    updatedAt: new Date().toISOString(),
  };
  await storeSetJson(userKeyByEmail(normalized), updated);
  return updated;
}

export async function updateUserRecoveryCode({ email, recoveryCodeHash }) {
  const normalized = normalizeEmail(email);
  const existing = await findUserByEmail(normalized);
  if (!existing) return null;

  const updated = {
    ...existing,
    recoveryCodeHash: String(recoveryCodeHash || ""),
    updatedAt: new Date().toISOString(),
  };
  await storeSetJson(userKeyByEmail(normalized), updated);
  return updated;
}

export async function saveUserBills({ userId, payload }) {
  const now = new Date().toISOString();
  const record = {
    userId: String(userId),
    updatedAt: now,
    payload,
  };
  await storeSetJson(billsKeyByUserId(userId), record);
  return record;
}

export async function loadUserBills(userId) {
  return storeGetJson(billsKeyByUserId(userId));
}

export async function clearUserBills(userId) {
  await storeDelete(billsKeyByUserId(userId));
}

export async function deleteUserAccount({ email, userId }) {
  const normalized = normalizeEmail(email);
  await Promise.all([
    storeDelete(userKeyByEmail(normalized)),
    storeDelete(billsKeyByUserId(userId)),
  ]);
}

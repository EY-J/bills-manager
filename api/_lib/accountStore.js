import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const LOCAL_STORE_CACHE_KEY = "__bills_manager_account_store_local_cache_v1__";

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
  return getKvConfig() ? "kv" : "local";
}

export function isPersistentStoreConfigured() {
  return Boolean(getKvConfig());
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
  if (!config) {
    if (allowLocalFallback()) return null;
    throw new Error("Cloud account storage is not configured.");
  }

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
  const commands = [["GET", String(key)]];
  const kvResult = await runKvPipeline(commands);
  if (kvResult) {
    return parseJsonString(kvResult[0]);
  }

  const cache = await ensureLocalStoreLoaded();
  const raw = cache.map.get(String(key));
  return parseJsonString(raw);
}

export async function storeSetJson(key, value) {
  const raw = JSON.stringify(value);
  const commands = [["SET", String(key), raw]];
  const kvResult = await runKvPipeline(commands);
  if (kvResult) return;

  await withLocalStoreWrite((map) => {
    map.set(String(key), raw);
  });
}

export async function storeDelete(key) {
  const commands = [["DEL", String(key)]];
  const kvResult = await runKvPipeline(commands);
  if (kvResult) return;

  await withLocalStoreWrite((map) => {
    map.delete(String(key));
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

export async function createUser({ email, passwordHash, passwordSalt }) {
  const normalized = normalizeEmail(email);
  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    email: normalized,
    passwordHash: String(passwordHash),
    passwordSalt: String(passwordSalt),
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

  const updated = {
    ...existing,
    passwordHash: String(passwordHash),
    passwordSalt: String(passwordSalt),
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

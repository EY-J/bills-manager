import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function loadStoreModule() {
  const cacheBuster = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return import(`../api/_lib/accountStore.js?cache=${cacheBuster}`);
}

test("account store local fallback persists values across module reload", async () => {
  const previousLocalStorePath = process.env.ACCOUNT_LOCAL_STORE_FILE;
  const previousKvUrl = process.env.KV_REST_API_URL;
  const previousKvToken = process.env.KV_REST_API_TOKEN;

  const filePath = path.join(
    os.tmpdir(),
    `bills-account-store-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );

  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  process.env.ACCOUNT_LOCAL_STORE_FILE = filePath;

  try {
    const storeA = await loadStoreModule();
    assert.equal(storeA.getStoreMode(), "local");

    await storeA.storeSetJson("account:test:user", {
      email: "persist-check@example.com",
      createdAt: new Date().toISOString(),
    });

    const writtenFile = await fs.readFile(filePath, "utf8");
    assert.match(writtenFile, /account:test:user/);

    const storeB = await loadStoreModule();
    const restored = await storeB.storeGetJson("account:test:user");
    assert.equal(restored?.email, "persist-check@example.com");

    await storeB.storeDelete("account:test:user");
    const deleted = await storeB.storeGetJson("account:test:user");
    assert.equal(deleted, null);
  } finally {
    if (previousLocalStorePath == null) {
      delete process.env.ACCOUNT_LOCAL_STORE_FILE;
    } else {
      process.env.ACCOUNT_LOCAL_STORE_FILE = previousLocalStorePath;
    }

    if (previousKvUrl == null) {
      delete process.env.KV_REST_API_URL;
    } else {
      process.env.KV_REST_API_URL = previousKvUrl;
    }

    if (previousKvToken == null) {
      delete process.env.KV_REST_API_TOKEN;
    } else {
      process.env.KV_REST_API_TOKEN = previousKvToken;
    }

    await fs.rm(filePath, { force: true });
  }
});

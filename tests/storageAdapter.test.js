import test from "node:test";
import assert from "node:assert/strict";
import { localStorageAdapter } from "../src/lib/storage/localStorageAdapter.js";

function createFakeLocalStorage() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    _keys() {
      return Array.from(store.keys());
    },
  };
}

test("storage adapter mirrors writes to backup and can remove both keys", () => {
  const original = globalThis.localStorage;
  const fake = createFakeLocalStorage();
  globalThis.localStorage = fake;
  try {
    localStorageAdapter.set("demo_key", { ok: true });
    assert.equal(fake.getItem("demo_key"), '{"ok":true}');
    assert.equal(fake.getItem("demo_key__backup"), '{"ok":true}');

    localStorageAdapter.remove("demo_key");
    assert.equal(fake.getItem("demo_key"), null);
    assert.equal(fake.getItem("demo_key__backup"), null);
  } finally {
    globalThis.localStorage = original;
  }
});

test("storage adapter recovers from malformed primary JSON using backup", () => {
  const original = globalThis.localStorage;
  const fake = createFakeLocalStorage();
  globalThis.localStorage = fake;
  try {
    localStorageAdapter.set("demo_key", { count: 1 });
    fake.setItem("demo_key", "{bad json");

    const recovered = localStorageAdapter.get("demo_key");
    assert.deepEqual(recovered, { count: 1 });
    assert.equal(fake.getItem("demo_key"), fake.getItem("demo_key__backup"));

    const hasCorruptArchive = fake
      ._keys()
      .some((k) => k.startsWith("demo_key__corrupt_"));
    assert.equal(hasCorruptArchive, true);
  } finally {
    globalThis.localStorage = original;
  }
});

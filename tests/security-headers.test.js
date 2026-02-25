import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loadVercelConfig() {
  const raw = await readFile(new URL("../vercel.json", import.meta.url), "utf8");
  return JSON.parse(raw);
}

function getHeaderMap(config) {
  const rules = Array.isArray(config?.headers) ? config.headers : [];
  const globalRule = rules.find((rule) => rule?.source === "/(.*)") || rules[0];
  const entries = Array.isArray(globalRule?.headers) ? globalRule.headers : [];

  const map = new Map();
  for (const item of entries) {
    if (!item?.key) continue;
    map.set(String(item.key).toLowerCase(), String(item.value || ""));
  }
  return map;
}

test("vercel.json includes required baseline security headers", async () => {
  const config = await loadVercelConfig();
  const headers = getHeaderMap(config);

  const required = [
    "content-security-policy",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
    "strict-transport-security",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
  ];

  for (const key of required) {
    assert.equal(headers.has(key), true, `Missing required header: ${key}`);
  }
});

test("content-security-policy keeps strict protections", async () => {
  const config = await loadVercelConfig();
  const headers = getHeaderMap(config);
  const csp = headers.get("content-security-policy") || "";

  assert.match(csp, /default-src\s+'self'/i);
  assert.match(csp, /script-src\s+'self'/i);
  assert.match(csp, /connect-src\s+'self'/i);
  assert.match(csp, /object-src\s+'none'/i);
  assert.match(csp, /frame-ancestors\s+'none'/i);
  assert.match(csp, /base-uri\s+'self'/i);
  assert.doesNotMatch(csp, /unsafe-eval/i);
});


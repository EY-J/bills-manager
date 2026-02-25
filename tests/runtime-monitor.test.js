import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveMonitoringEndpoint,
  sanitizeRuntimeHref,
  sanitizeRuntimeText,
  shouldSendRuntimePayload,
  resetRuntimeMonitorStateForTests,
} from "../src/lib/monitoring/runtimeMonitor.js";

function samplePayload(overrides = {}) {
  return {
    message: "Example runtime crash",
    name: "Error",
    href: "https://app.local/",
    context: { source: "window.error" },
    ...overrides,
  };
}

test("runtime monitor deduplicates identical payloads in the dedupe window", () => {
  resetRuntimeMonitorStateForTests();

  const first = shouldSendRuntimePayload(samplePayload(), 1_000);
  const second = shouldSendRuntimePayload(samplePayload(), 5_000);
  const afterWindow = shouldSendRuntimePayload(samplePayload(), 32_000);

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(afterWindow, true);
});

test("runtime monitor caps sends per minute window and resets after window", () => {
  resetRuntimeMonitorStateForTests();
  const now = 10_000;

  for (let i = 0; i < 20; i += 1) {
    const ok = shouldSendRuntimePayload(
      samplePayload({ message: `Unique error ${i}` }),
      now + i
    );
    assert.equal(ok, true);
  }

  const overLimit = shouldSendRuntimePayload(
    samplePayload({ message: "Unique error overflow" }),
    now + 30
  );
  assert.equal(overLimit, false);

  const afterReset = shouldSendRuntimePayload(
    samplePayload({ message: "Unique after window reset" }),
    now + 61_000
  );
  assert.equal(afterReset, true);
});

test("runtime monitor endpoint resolver allows same-origin and blocks cross-origin", () => {
  const current = "https://app.local/dashboard";

  const relative = resolveMonitoringEndpoint("/api/runtime-errors", current);
  const absoluteSameOrigin = resolveMonitoringEndpoint(
    "https://app.local/api/runtime-errors",
    current
  );
  const crossOrigin = resolveMonitoringEndpoint(
    "https://evil.example/runtime-errors",
    current
  );
  const scriptUrl = resolveMonitoringEndpoint("javascript:alert(1)", current);

  assert.equal(relative, "https://app.local/api/runtime-errors");
  assert.equal(absoluteSameOrigin, "https://app.local/api/runtime-errors");
  assert.equal(crossOrigin, "");
  assert.equal(scriptUrl, "");
});

test("runtime monitor sanitizes sensitive tokens and emails from telemetry text", () => {
  const text =
    "user test@example.com token=abc123 Bearer SECRET123 password:hunter2 apiKey=xyz";
  const sanitized = sanitizeRuntimeText(text);

  assert.equal(sanitized.includes("test@example.com"), false);
  assert.equal(sanitized.includes("abc123"), false);
  assert.equal(sanitized.includes("SECRET123"), false);
  assert.equal(sanitized.includes("hunter2"), false);
  assert.equal(sanitized.includes("xyz"), false);
  assert.match(sanitized, /\[redacted\]/);
});

test("runtime monitor strips query and hash from hrefs", () => {
  const href = sanitizeRuntimeHref("https://app.local/path?a=1&token=secret#frag");
  assert.equal(href, "https://app.local/path");
});

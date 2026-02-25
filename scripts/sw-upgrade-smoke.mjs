#!/usr/bin/env node
/**
 * Service worker upgrade regression smoke.
 *
 * Checks:
 * - A manually registered SW version creates versioned caches.
 * - Upgrading to a newer SW version removes old version caches.
 * - App emits update-ready signal after upgrade registration.
 */

import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const HOST = "127.0.0.1";
const NPM_EXEC_PATH = String(process.env.npm_execpath || "").trim();
const NPM_FALLBACK_CMD = process.platform === "win32" ? "npm.cmd" : "npm";
const SPAWN_OPTIONS = {
  stdio: "inherit",
  shell: false,
};

function runCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, SPAWN_OPTIONS);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code ?? "unknown"}`));
    });
  });
}

function startPreviewServer(port) {
  const args = [
    "run",
    "preview",
    "--",
    "--host",
    HOST,
    "--port",
    String(port),
    "--strictPort",
  ];
  const { command, argv } = resolveNpmInvocation(args);
  return spawn(
    command,
    argv,
    SPAWN_OPTIONS
  );
}

function runNpm(args, label) {
  const { command, argv } = resolveNpmInvocation(args);
  return runCommand(command, argv, label);
}

function resolveNpmInvocation(args) {
  if (NPM_EXEC_PATH) {
    return { command: process.execPath, argv: [NPM_EXEC_PATH, ...args] };
  }
  return { command: NPM_FALLBACK_CMD, argv: args };
}

function normalizeBaseUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Base URL must use http or https.");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid SW_BASE_URL: ${msg}`);
  }
}

async function findFreePort(host = HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not resolve free TCP port")));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForServer(url, timeoutMs = 45_000) {
  const parsed = new URL(url);
  const client = parsed.protocol === "https:" ? https : http;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = client.get(url, (res) => {
        res.resume();
        resolve(Boolean(res.statusCode && res.statusCode < 500));
      });
      req.on("error", () => resolve(false));
    });
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`Preview target did not respond within ${timeoutMs}ms`);
}

async function stopPreviewProcess(preview) {
  if (!preview || preview.killed) return;

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(preview.pid), "/t", "/f"],
        { stdio: "ignore", shell: false }
      );
      killer.on("error", () => resolve());
      killer.on("exit", () => resolve());
    });
    return;
  }

  preview.kill("SIGTERM");
  const started = Date.now();
  while (Date.now() - started < 2_000) {
    if (preview.exitCode != null) return;
    await sleep(100);
  }
  if (preview.exitCode == null) preview.kill("SIGKILL");
}

async function waitForAssertion(assertion, label, timeoutMs = 10_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await sleep(120);
    }
  }
  const message =
    lastError instanceof Error ? lastError.message : String(lastError ?? "timed out");
  throw new Error(`${label}: ${message}`);
}

async function registerVersion(page, version) {
  await page.evaluate(async (nextVersion) => {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service worker is not supported in this browser.");
    }

    const swUrl = `/sw.js?v=${encodeURIComponent(String(nextVersion))}`;
    const registration = await navigator.serviceWorker.register(swUrl, {
      updateViaCache: "none",
    });
    await registration.update();
    await navigator.serviceWorker.ready;
  }, version);

  await waitForAssertion(async () => {
    const hasController = await page.evaluate(
      () => Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)
    );
    assert.equal(hasController, true);
  }, `service worker controller active for ${version}`);
}

async function getCacheKeys(page) {
  return page.evaluate(async () => caches.keys());
}

async function main() {
  const externalBaseUrlRaw = String(process.env.SW_BASE_URL || "").trim();
  const isExternalRun = externalBaseUrlRaw.length > 0;
  const baseUrl = isExternalRun
    ? normalizeBaseUrl(externalBaseUrlRaw)
    : `http://${HOST}:${await findFreePort(HOST)}`;

  let preview = null;
  let browser = null;

  const stopPreview = async () => {
    await stopPreviewProcess(preview);
  };

  process.on("SIGINT", () => {
    void stopPreview().finally(() => process.exit(130));
  });
  process.on("SIGTERM", () => {
    void stopPreview().finally(() => process.exit(143));
  });

  try {
    if (!isExternalRun) {
      if (!process.env.SKIP_BUILD) {
        await runNpm(["run", "build"], "Build");
      }
      preview = startPreviewServer(new URL(baseUrl).port);
    }

    await waitForServer(baseUrl);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator('h2:has-text("Bills Tracker")').first().waitFor({
      state: "visible",
      timeout: 12_000,
    });

    const versionA = `upgrade-a-${Date.now()}`;
    const versionB = `upgrade-b-${Date.now()}`;

    await registerVersion(page, versionA);
    await waitForAssertion(async () => {
      const keys = await getCacheKeys(page);
      assert.ok(
        keys.some((key) => key.includes(versionA)),
        `expected cache for ${versionA}; got [${keys.join(", ")}]`
      );
    }, "first SW version cache created");

    await page.evaluate(() => {
      window.__swUpdateReadyFlag = false;
      window.addEventListener(
        "app:update-ready",
        () => {
          window.__swUpdateReadyFlag = true;
        },
        { once: true }
      );
    });

    await registerVersion(page, versionB);
    await waitForAssertion(async () => {
      const keys = await getCacheKeys(page);
      assert.ok(
        keys.some((key) => key.includes(versionB)),
        `expected cache for ${versionB}; got [${keys.join(", ")}]`
      );
      assert.equal(
        keys.some((key) => key.includes(versionA)),
        false,
        `stale cache for ${versionA} still exists: [${keys.join(", ")}]`
      );
    }, "SW upgrade cleans stale caches");

    await waitForAssertion(async () => {
      const updateReadyFired = await page.evaluate(() =>
        Boolean(window.__swUpdateReadyFlag)
      );
      assert.equal(updateReadyFired, true);
    }, "app update-ready event emitted");

    await context.close();

    console.log(
      `Service worker upgrade smoke passed [${
        isExternalRun ? "external preview" : "local preview"
      }].`
    );
  } finally {
    if (browser) await browser.close();
    await stopPreview();
  }
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("Executable doesn't exist")) {
    console.error("\nPlaywright Chromium is not installed.");
    console.error("Run: npm run test:responsive:install\n");
  }
  console.error(msg);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Offline readiness smoke test.
 *
 * Checks:
 * - Existing local data remains visible after going offline and reloading.
 * - Core screens still work offline (list, details, settings).
 * - Local actions still work offline (mark paid + undo).
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

const VIEWPORTS = [
  { name: "iPhone 12/13", width: 390, height: 844 },
  { name: "Desktop", width: 1366, height: 768 },
];

function selectViewports() {
  const raw = String(process.env.OFFLINE_VIEWPORTS || "").trim();
  if (!raw) return VIEWPORTS;

  const tokens = raw
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  const selected = VIEWPORTS.filter((vp) =>
    tokens.some(
      (token) =>
        vp.name.toLowerCase().includes(token) || `${vp.width}x${vp.height}` === token
    )
  );

  if (selected.length === 0) {
    throw new Error(
      `No viewports matched OFFLINE_VIEWPORTS="${raw}". Try "iphone,desktop" or "390x844".`
    );
  }

  return selected;
}

function seedPayload() {
  return {
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    data: {
      bills: [
        {
          id: "offline-seed-1",
          name: "Offline Water",
          category: "Housing",
          dueDate: "2026-03-15",
          amount: 450,
          notes: "Seed for offline CI check",
          payments: [],
          cadence: "monthly",
          reminderDays: 3,
          totalMonths: 0,
          paidMonths: 0,
          cyclePaidAmount: 0,
          archived: false,
        },
        {
          id: "offline-seed-2",
          name: "Offline Internet",
          category: "Utilities",
          dueDate: "2026-03-20",
          amount: 1200,
          notes: "Seed for offline CI check",
          payments: [],
          cadence: "monthly",
          reminderDays: 1,
          totalMonths: 0,
          paidMonths: 0,
          cyclePaidAmount: 0,
          archived: false,
        },
      ],
    },
  };
}

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
    throw new Error(`Invalid OFFLINE_BASE_URL: ${msg}`);
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

async function seedData(page) {
  const payload = seedPayload();
  await page.evaluate((data) => {
    localStorage.clear();
    localStorage.setItem("bills_manager_v1", JSON.stringify(data));
    localStorage.setItem("bills_notify_enabled", "false");
    localStorage.setItem("bills_compact_mode", "false");
    localStorage.setItem("bills_table_density", "comfortable");
    localStorage.setItem("bills_notify_mode", "digest");
  }, payload);
}

async function getBillRowCount(page) {
  return page
    .locator(".billsTable tbody tr")
    .filter({ has: page.locator("td") })
    .count();
}

async function waitForAppReady(page) {
  await page.locator('h2:has-text("Bills Tracker")').first().waitFor({
    state: "visible",
    timeout: 12_000,
  });
}

async function ensureServiceWorkerControl(page) {
  for (let i = 0; i < 3; i += 1) {
    const controlled = await page.evaluate(
      () => Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)
    );
    if (controlled) return;
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await sleep(250);
  }
  throw new Error("Service worker did not take control before offline transition");
}

async function openAndCloseSettings(page) {
  await page.locator('button[aria-label="Open settings"]:visible').first().click();
  const settingsModal = page.locator(".settingsModal").first();
  await settingsModal.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('button[aria-label="Close settings"]:visible').first().click();
  await settingsModal.waitFor({ state: "hidden", timeout: 10_000 });
}

async function openDetails(page) {
  const firstRow = page.locator(".billsTable tbody tr").first();
  await firstRow.waitFor({ state: "visible", timeout: 10_000 });
  await firstRow.locator("td").first().click();
  const details = page.locator(".modal.modal-lg").first();
  await details.waitFor({ state: "visible", timeout: 10_000 });
  return details;
}

async function runOfflineActionCheck(page, viewportName) {
  const details = await openDetails(page);
  await details.getByRole("button", { name: /^Overview$/i }).first().click();
  await details.getByRole("button", { name: /^Mark paid$/i }).first().click();

  const toast = page.locator(".undoToast").filter({ hasText: "Marked as paid" }).first();
  await toast.waitFor({ state: "visible", timeout: 10_000 });
  await page.evaluate((message) => {
    const node = Array.from(document.querySelectorAll(".undoToast")).find((entry) =>
      (entry.textContent || "").includes(String(message))
    );
    if (!node) {
      throw new Error(`Undo toast not found: ${String(message)}`);
    }
    const button = node.querySelector(".toastInlineAction");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Undo button missing: ${String(message)}`);
    }
    button.click();
  }, "Marked as paid");
  await waitForAssertion(async () => {
    const stillVisible = await page
      .locator(".undoToast")
      .filter({ hasText: "Marked as paid" })
      .count();
    assert.equal(stillVisible, 0);
  }, `${viewportName}: undo mark paid`);

  await details.locator('button[aria-label="Close"]').first().click();
  await details.waitFor({ state: "hidden", timeout: 10_000 });
  console.log(`  Offline local action ok (${viewportName})`);
}

async function runViewportCheck(browser, viewport, baseUrl) {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.width <= 700,
    hasTouch: viewport.width <= 1024,
  });

  const page = await context.newPage();
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);

    await seedData(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page);

    const onlineRows = await getBillRowCount(page);
    assert.ok(onlineRows > 0, `${viewport.name}: expected at least one seeded bill online`);

    await openAndCloseSettings(page);
    const detailsOnline = await openDetails(page);
    await detailsOnline.locator('button[aria-label="Close"]').first().click();
    await detailsOnline.waitFor({ state: "hidden", timeout: 10_000 });

    await ensureServiceWorkerControl(page);

    await context.setOffline(true);
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`${viewport.name}: reload failed while offline (${msg})`);
    }
    await waitForAppReady(page);

    const offlineRows = await getBillRowCount(page);
    assert.equal(
      offlineRows,
      onlineRows,
      `${viewport.name}: bill count changed after offline reload (${onlineRows} -> ${offlineRows})`
    );

    await openAndCloseSettings(page);
    await runOfflineActionCheck(page, viewport.name);
    await context.setOffline(false);

    return { ...viewport, status: "pass" };
  } catch (error) {
    return {
      ...viewport,
      status: "fail",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const externalBaseUrlRaw = String(process.env.OFFLINE_BASE_URL || "").trim();
  const isExternalRun = externalBaseUrlRaw.length > 0;
  const baseUrl = isExternalRun
    ? normalizeBaseUrl(externalBaseUrlRaw)
    : `http://${HOST}:${await findFreePort(HOST)}`;
  const viewports = selectViewports();

  let preview = null;
  let browser = null;
  const results = [];

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

    console.log(
      `Running offline readiness checks on ${viewports.length} viewport(s) [${
        isExternalRun ? "external preview" : "local preview"
      }]...`
    );

    for (const viewport of viewports) {
      console.log(`Checking ${viewport.name} (${viewport.width}x${viewport.height})...`);
      const outcome = await runViewportCheck(browser, viewport, baseUrl);
      results.push(outcome);
    }

    console.log("\nOffline readiness results:");
    for (const result of results) {
      if (result.status === "pass") {
        console.log(`PASS  ${result.name} (${result.width}x${result.height})`);
      } else {
        console.log(`FAIL  ${result.name} (${result.width}x${result.height}) -> ${result.error}`);
      }
    }

    const failed = results.some((result) => result.status === "fail");
    if (failed) process.exitCode = 1;
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

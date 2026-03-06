#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { createBackupPayload } from "../src/features/bills/billsService.js";
import {
  deleteCreatedAccountIfNeeded,
  ensureAuthenticatedSession,
} from "./_e2e-account-session.mjs";

const HOST = "127.0.0.1";
const NPM_EXEC_PATH = String(process.env.npm_execpath || "").trim();
const NPM_FALLBACK_CMD = process.platform === "win32" ? "npm.cmd" : "npm";
const SPAWN_OPTIONS = {
  stdio: "inherit",
  shell: false,
};
const E2E_UNLOCK_KEY = "__bills_e2e_unlock_session_v1";
const ACCOUNT_KNOWN_KEY = "bills_account_known_v1";

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

function normalizeBaseUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Base URL must use http or https.");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid E2E_BASE_URL: ${msg}`);
  }
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

function restoreBillsFixture() {
  return [
    {
      id: "restore-e2e-1",
      name: "Restore Target",
      category: "Utilities",
      dueDate: "2026-04-10",
      amount: 700,
      notes: "from restore fixture",
      payments: [],
      cadence: "monthly",
      reminderDays: 3,
      totalMonths: 0,
      paidMonths: 0,
      cyclePaidAmount: 0,
      archived: false,
    },
  ];
}

async function createRestoreFile() {
  const payload = createBackupPayload({
    bills: restoreBillsFixture(),
    notifyEnabled: false,
  });
  const filePath = path.join(
    os.tmpdir(),
    `bills-restore-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  );
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
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
      await sleep(150);
    }
  }
  const message =
    lastError instanceof Error ? lastError.message : String(lastError ?? "timed out");
  throw new Error(`${label}: ${message}`);
}

async function waitForTrackerOrAccountLocked(page, timeoutMs = 12_000) {
  const started = Date.now();
  let sawAccountLocked = false;
  while (Date.now() - started < timeoutMs) {
    const state = await page.evaluate(() => {
      const hasTracker = Boolean(
        document.querySelector('[data-testid="bills-tracker-title"]')
      );
      const hasTrackerHeading = Array.from(document.querySelectorAll("h2")).some(
        (node) => node.textContent?.trim() === "Bills Tracker"
      );
      const hasAccountLocked = Boolean(
        document.querySelector('[data-testid="account-locked-card"]')
      );
      if (hasTracker || hasTrackerHeading) return "tracker";
      if (hasAccountLocked) return "account-locked";
      return "";
    });
    if (state === "tracker") return "tracker";
    if (state === "account-locked") {
      sawAccountLocked = true;
    }
    await sleep(120);
  }
  if (sawAccountLocked) return "account-locked";
  throw new Error(`App did not render tracker/account lock within ${timeoutMs}ms`);
}

async function waitForToast(page, text) {
  const toast = page.locator(".undoToast, .noticeToast").filter({ hasText: text }).first();
  await toast.waitFor({ state: "visible", timeout: 10_000 });
  return toast;
}

async function readDetailsStatValue(page, label) {
  return page.evaluate((targetLabel) => {
    const stats = Array.from(document.querySelectorAll(".modal.modal-lg .stat"));
    const stat = stats.find(
      (node) =>
        node.querySelector(".muted.small")?.textContent?.trim().toLowerCase() ===
        String(targetLabel || "").trim().toLowerCase()
    );
    return stat?.querySelector(".bold")?.textContent?.trim() || null;
  }, label);
}

async function readFirstPaymentAmountText(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".paymentHistoryTable tbody tr"));
    const row = rows.find((entry) => !entry.querySelector("td[colspan]"));
    return row?.querySelector("td.amountCol")?.textContent?.trim() || "";
  });
}

function getBillRow(page, name) {
  return page.locator(".billsTable tbody tr").filter({ hasText: name }).first();
}

async function openSettings(page) {
  const desktopSettingsButton = page.getByTestId("open-settings-button-desktop").first();
  const mobileSettingsButton = page.getByTestId("open-settings-button-mobile").first();
  if ((await desktopSettingsButton.count()) > 0 && (await desktopSettingsButton.isVisible())) {
    await desktopSettingsButton.click();
  } else if ((await mobileSettingsButton.count()) > 0 && (await mobileSettingsButton.isVisible())) {
    await mobileSettingsButton.click();
  } else {
    await page.locator('button[aria-label="Open settings"]:visible').first().click();
  }
  const settingsModal = page.locator(".settingsModal").first();
  await settingsModal.waitFor({ state: "visible", timeout: 10_000 });
  return settingsModal;
}

async function runCriticalFlow(
  page,
  restoreFilePath,
  { allowAccountLockedSkip = false, requireExternalAccount = false } = {}
) {
  let createdAccount = { created: false, password: "" };

  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (allowAccountLockedSkip) {
      const authResult = await ensureAuthenticatedSession(page, {
        label: "critical-flow",
        strict: requireExternalAccount,
      });
      if (authResult.status !== "pass") {
        if (authResult.status === "fail") {
          return {
            status: "fail",
            error: authResult.reason,
          };
        }
        return {
          status: "skip",
          note: `Critical bill-flow checks skipped: ${authResult.reason}`,
        };
      }
      createdAccount = authResult;
    }

    await page.evaluate(({ unlockKey, knownKey }) => {
      localStorage.clear();
      localStorage.setItem("bills_notify_enabled", "false");
      localStorage.setItem("bills_compact_mode", "false");
      localStorage.setItem("bills_table_density", "comfortable");
      localStorage.setItem("bills_notify_mode", "digest");
      localStorage.setItem(unlockKey, "1");
      localStorage.setItem(knownKey, "1");
    }, { unlockKey: E2E_UNLOCK_KEY, knownKey: ACCOUNT_KNOWN_KEY });
    await page.reload({ waitUntil: "domcontentloaded" });

    const readyState = await waitForTrackerOrAccountLocked(page);
    if (readyState === "account-locked") {
      const note = "Critical bill-flow checks skipped: deployed app remained account-locked.";
      if (allowAccountLockedSkip) {
        if (requireExternalAccount) {
          return {
            status: "fail",
            error: note,
          };
        }
        return {
          status: "skip",
          note,
        };
      }
      throw new Error("Bills tracker did not unlock after seeded local session.");
    }

    const billName = `E2E Bill ${Date.now()}`;

  // 1) Create bill
  console.log("Step 1/6: create bill");
  const addBillButton = page.getByTestId("add-bill-button").first();
  if ((await addBillButton.count()) > 0 && (await addBillButton.isVisible())) {
    await addBillButton.click();
  } else {
    await page.locator('button.btn.primary:has-text("+ Add bill"):visible').first().click();
  }
  const editor = page.locator(".billEditorModal").first();
  await editor.waitFor({ state: "visible", timeout: 10_000 });
  await editor.getByPlaceholder("e.g., Water & Sewer").fill(billName);
  await editor.locator('div.field:has(label:has-text("Amount")) input').first().fill("150");
  await editor.getByRole("button", { name: /^Save$/i }).click();
  await editor.waitFor({ state: "hidden", timeout: 12_000 });
  await waitForToast(page, "Bill added");
  await getBillRow(page, billName).waitFor({ state: "visible", timeout: 12_000 });

  // 2) Mark paid
  console.log("Step 2/6: mark paid");
  await getBillRow(page, billName).click();
  const details = page.locator(".modal.modal-lg").first();
  await details.waitFor({ state: "visible", timeout: 10_000 });
  const paymentsBefore = Number(await readDetailsStatValue(page, "Payments"));
  assert.ok(Number.isFinite(paymentsBefore), "Could not read initial payment count");
  await details.getByRole("button", { name: /^Mark paid$/i }).first().click();
  await waitForToast(page, "Marked as paid");
  await waitForAssertion(async () => {
    const paymentsAfter = Number(await readDetailsStatValue(page, "Payments"));
    assert.equal(paymentsAfter, paymentsBefore + 1);
  }, "mark paid updates payment count");

  // 3) Edit payment
  console.log("Step 3/6: edit payment");
  await details.getByRole("button", { name: /^Payments$/i }).first().click();
  await page
    .locator(".paymentHistoryTable tbody tr")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
  await page
    .locator(".paymentHistoryTable tbody tr")
    .first()
    .getByRole("button", { name: /^Edit$/i })
    .click();
  await details.locator(".amountField").first().fill("175");
  await details.getByRole("button", { name: /^Save changes$/i }).first().click();
  await waitForToast(page, "Payment updated");
  await waitForAssertion(async () => {
    const text = await readFirstPaymentAmountText(page);
    assert.match(text, /175/);
  }, "edited payment amount reflects in history");
  await details.locator('button[aria-label="Close"]').first().click();
  await details.waitFor({ state: "hidden", timeout: 10_000 });

  // 4) Backup
  console.log("Step 4/6: backup");
  const settingsA = await openSettings(page);
  const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
  await settingsA.getByRole("button", { name: /^Backup data$/i }).first().click();
  await page.locator(".settingsModal").first().waitFor({ state: "hidden", timeout: 10_000 });
  const download = await downloadPromise;
  assert.ok(download, "Backup did not trigger a download event");
  const failure = await download.failure();
  assert.equal(failure, null, `Backup download failed: ${failure}`);

  // 5) Restore
  console.log("Step 5/6: restore");
  const settingsB = await openSettings(page);
  await settingsB.getByRole("button", { name: /^Restore data$/i }).first().click();
  await settingsB.locator(".hiddenFileInput").setInputFiles(restoreFilePath);
  await settingsB
    .locator(".settingsImportTitle")
    .filter({ hasText: /Restore preview/i })
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
  await settingsB.getByRole("button", { name: /^Apply restore$/i }).first().click();
  const restoreConfirm = page.locator(".confirmModal").first();
  await restoreConfirm.waitFor({ state: "visible", timeout: 10_000 });
  await restoreConfirm.getByRole("button", { name: /^Yes, apply$/i }).first().click();
  await page.locator(".settingsModal").first().waitFor({ state: "hidden", timeout: 10_000 });
  await waitForToast(page, "Restore applied");
  await getBillRow(page, "Restore Target").waitFor({ state: "visible", timeout: 12_000 });

  // 6) Clear + Undo
  console.log("Step 6/6: clear + undo");
  const settingsC = await openSettings(page);
  await settingsC.getByRole("button", { name: /^Clear all bills$/i }).first().click();
  const clearConfirm = page.locator(".confirmModal").first();
  await clearConfirm.waitFor({ state: "visible", timeout: 10_000 });
  await clearConfirm.getByRole("button", { name: /^Yes, clear$/i }).first().click();
  await page.getByText("No bills found").first().waitFor({ state: "visible", timeout: 12_000 });
  const clearToast = await waitForToast(page, "All bills cleared");
  await clearToast.getByRole("button", { name: /^Undo$/i }).first().click();
  await getBillRow(page, "Restore Target").waitFor({ state: "visible", timeout: 12_000 });

    return { status: "pass" };
  } finally {
    await deleteCreatedAccountIfNeeded(page, createdAccount);
  }
}

async function main() {
  const externalBaseUrlRaw = String(process.env.E2E_BASE_URL || "").trim();
  const isExternalRun = externalBaseUrlRaw.length > 0;
  const baseUrl = isExternalRun
    ? normalizeBaseUrl(externalBaseUrlRaw)
    : `http://${HOST}:${await findFreePort(HOST)}`;

  let preview = null;
  let browser = null;
  let restoreFilePath = "";

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
    restoreFilePath = await createRestoreFile();

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1366, height: 900 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const outcome = await runCriticalFlow(page, restoreFilePath, {
      allowAccountLockedSkip: isExternalRun,
      requireExternalAccount:
        isExternalRun && String(process.env.E2E_REQUIRE_ACCOUNT || "").trim() === "1",
    });
    await context.close();

    if (outcome.status === "fail") {
      throw new Error(outcome.error || "Critical flow checks failed.");
    }

    if (outcome.status === "skip") {
      console.log(`SKIP  critical flow checks -> ${outcome.note}`);
      return;
    }

    console.log(
      `Critical deployed flow checks passed [${
        isExternalRun ? "external preview" : "local preview"
      }].`
    );
  } finally {
    if (browser) await browser.close();
    await stopPreview();
    if (restoreFilePath) {
      await fs.unlink(restoreFilePath).catch(() => {});
    }
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

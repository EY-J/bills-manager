#!/usr/bin/env node
/**
 * Responsive smoke test (tutorial + runner).
 *
 * Quick start:
 * 1) One-time browser install:
 *    npm run test:responsive:install
 * 2) Run checks (build + preview + viewport matrix):
 *    npm run test:responsive
 * 3) Faster rerun using existing dist build:
 *    SKIP_BUILD=1 npm run test:responsive
 * 4) Run against deployed preview URL (CI/deploy smoke):
 *    RESPONSIVE_BASE_URL=https://your-preview-url.vercel.app npm run test:responsive
 *
 * What this checks on each viewport:
 * - No page-level horizontal overflow
 * - Settings modal fits viewport width
 * - Bill details modal fits viewport width
 * - Edit bill modal fits viewport width
 * - No overflow while modals are open
 * - Settings interactions apply visual state (compact mode, table density)
 * - Bill behavior flows work (mark paid -> undo, add payment -> undo, edit -> undo)
 */

import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
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

const VIEWPORTS = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 12/13", width: 390, height: 844 },
  { name: "Pixel 7", width: 412, height: 915 },
  { name: "iPad", width: 768, height: 1024 },
  { name: "iPad Landscape", width: 1024, height: 768 },
  { name: "Laptop", width: 1366, height: 768 },
  { name: "Desktop FHD", width: 1920, height: 1080 },
];
const E2E_UNLOCK_KEY = "__bills_e2e_unlock_session_v1";
const ACCOUNT_KNOWN_KEY = "bills_account_known_v1";

function selectViewports() {
  const raw = String(process.env.RESPONSIVE_VIEWPORTS || "").trim();
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
      `No viewports matched RESPONSIVE_VIEWPORTS="${raw}". Try names like "iphone", "pixel", "desktop" or sizes like "390x844".`
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
          id: "qa-1",
          name: "Water",
          category: "Housing",
          dueDate: "2026-03-05",
          amount: 400,
          notes: "Monthly water bill",
          payments: [
            {
              id: "qa-pay-1",
              date: "2026-02-05",
              amount: 400,
              note: "Paid",
              settledCycles: 1,
            },
          ],
          cadence: "monthly",
          reminderDays: 3,
          totalMonths: 12,
          paidMonths: 2,
          cyclePaidAmount: 0,
          archived: false,
        },
        {
          id: "qa-2",
          name: "Internet",
          category: "Utilities",
          dueDate: "2026-02-25",
          amount: 1800,
          notes: "Fiber plan",
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
  const child = spawn(
    command,
    argv,
    SPAWN_OPTIONS
  );
  return child;
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
      throw new Error("Preview URL must use http or https.");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid RESPONSIVE_BASE_URL: ${msg}`);
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
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
  throw new Error(`Preview server did not start within ${timeoutMs}ms`);
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

async function seedData(page) {
  const payload = seedPayload();
  await page.evaluate(({ data, unlockKey, knownKey }) => {
    localStorage.setItem("bills_manager_v1", JSON.stringify(data));
    localStorage.setItem("bills_notify_enabled", "false");
    localStorage.setItem("bills_compact_mode", "false");
    localStorage.setItem("bills_table_density", "comfortable");
    localStorage.setItem("bills_notify_mode", "digest");
    localStorage.setItem(unlockKey, "1");
    localStorage.setItem(knownKey, "1");
  }, { data: payload, unlockKey: E2E_UNLOCK_KEY, knownKey: ACCOUNT_KNOWN_KEY });
}

async function clickFirstVisible(page, locators, label, timeoutMs = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const locator of locators) {
      if ((await locator.count()) === 0) continue;
      if (!(await locator.isVisible())) continue;
      await locator.click();
      return;
    }
    await sleep(120);
  }
  throw new Error(`Could not find visible control: ${label}`);
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  assert.ok(
    metrics.documentScrollWidth <= metrics.innerWidth + 1,
    `${label}: document overflow (${metrics.documentScrollWidth} > ${metrics.innerWidth})`
  );
  assert.ok(
    metrics.bodyScrollWidth <= metrics.innerWidth + 1,
    `${label}: body overflow (${metrics.bodyScrollWidth} > ${metrics.innerWidth})`
  );
}

async function assertElementFitsWidth(page, selector, viewportWidth, label) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 10_000 });
  const box = await el.boundingBox();
  assert.ok(box, `${label}: missing bounding box for ${selector}`);
  assert.ok(box.x >= -4, `${label}: left edge is out of bounds (${box.x})`);
  assert.ok(
    box.x + box.width <= viewportWidth + 4,
    `${label}: right edge is out of bounds (${box.x + box.width} > ${viewportWidth})`
  );
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

async function getAppClassName(page) {
  return page.evaluate(() => document.querySelector(".app")?.className || "");
}

async function getDetailsStatValue(page, label) {
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

async function getDetailsHeaderMeta(page) {
  return page.evaluate(() => {
    const node = document.querySelector(".modal.modal-lg .billHeaderMeta");
    return node?.textContent?.replace(/\s+/g, " ").trim() || null;
  });
}

async function getPaymentHistoryCount(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".paymentHistoryTable tbody tr"));
    return rows.filter((row) => !row.querySelector("td[colspan]")).length;
  });
}

async function getFirstBillName(page) {
  return page.evaluate(() => {
    const node = document.querySelector(".billsTable tbody tr .billName .bold");
    return node?.textContent?.trim() || null;
  });
}

async function clickUndoForToast(page, message, label) {
  const toast = page.locator(".undoToast").filter({ hasText: message }).first();
  await toast.waitFor({ state: "visible", timeout: 10_000 });

  await page.evaluate((targetMessage) => {
    const target = Array.from(document.querySelectorAll(".undoToast")).find((node) =>
      (node.textContent || "").includes(String(targetMessage))
    );
    if (!target) {
      throw new Error(`Undo toast not found for: ${String(targetMessage)}`);
    }
    const button = target.querySelector(".toastInlineAction");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Undo button missing for: ${String(targetMessage)}`);
    }
    button.click();
  }, message);

  await waitForAssertion(async () => {
    const remaining = await page.locator(".undoToast").filter({ hasText: message }).count();
    assert.equal(remaining, 0, `undo toast "${message}" is still visible`);
  }, label, 4_000);
}

async function openFirstBillDetails(page, viewportName) {
  const firstRow = page.locator(".billsTable tbody tr").first();
  await firstRow.waitFor({ state: "visible", timeout: 12_000 });

  const firstCell = firstRow.locator("td").first();
  await firstCell.click();

  await page
    .locator(".modal.modal-lg")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });

  await assertNoHorizontalOverflow(page, `${viewportName}: details opened from row`);
}

async function assertContainerScrollsIfNeeded(page, selector, label) {
  const metrics = await page.evaluate((targetSelector) => {
    const node = document.querySelector(targetSelector);
    if (!(node instanceof HTMLElement)) {
      return null;
    }
    const hasOverflow = node.scrollHeight > node.clientHeight + 1;
    if (!hasOverflow) {
      return {
        hasOverflow: false,
        scrollTopAfter: 0,
      };
    }
    node.scrollTop = Math.max(1, node.scrollHeight - node.clientHeight);
    return {
      hasOverflow: true,
      scrollTopAfter: node.scrollTop,
    };
  }, selector);

  assert.ok(metrics, `${label}: missing container ${selector}`);
  if (!metrics.hasOverflow) return;
  assert.ok(
    Number(metrics.scrollTopAfter) > 0,
    `${label}: container did not scroll despite overflow`
  );
}

async function openAccountModal(page) {
  await clickFirstVisible(
    page,
    [
      page.getByTestId("open-account-button").first(),
      page.getByTestId("mobile-nav-account").first(),
      page.locator('button[aria-label*="Open account"]:visible').first(),
    ],
    "Open account button"
  );
}

async function assertAccountModalResponsive(page, viewportWidth, viewportName) {
  const accountModal = page.getByTestId("account-modal").first();
  await accountModal.waitFor({ state: "visible", timeout: 10_000 });
  await assertElementFitsWidth(page, ".accountModal", viewportWidth, `${viewportName}: account modal`);
  await assertNoHorizontalOverflow(page, `${viewportName}: account open`);

  const changePasswordToggle = accountModal
    .getByRole("button", { name: /change password/i })
    .first();
  await changePasswordToggle.waitFor({ state: "visible", timeout: 10_000 });
  await changePasswordToggle.click();

  const changePasswordModal = page.getByTestId("account-change-password-modal").first();
  await changePasswordModal.waitFor({ state: "visible", timeout: 10_000 });
  await assertElementFitsWidth(
    page,
    ".accountChildModal",
    viewportWidth,
    `${viewportName}: account change password modal`
  );
  await assertNoHorizontalOverflow(page, `${viewportName}: account change password open`);

  await changePasswordModal
    .locator('input[aria-label="Current password"]')
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
  await assertContainerScrollsIfNeeded(
    page,
    ".accountChildModal .settingsBody",
    `${viewportName}: account change password scroll body`
  );
  await changePasswordModal.getByTestId("account-change-password-close").first().click();
  await changePasswordModal.waitFor({ state: "hidden", timeout: 10_000 });

  await accountModal.getByTestId("account-close-button").first().click();
  await accountModal.waitFor({ state: "hidden", timeout: 10_000 });
}

async function waitForTrackerOrAccountLocked(page, timeoutMs = 12_000) {
  const started = Date.now();
  let sawAccountLocked = false;
  while (Date.now() - started < timeoutMs) {
    const state = await page.evaluate(() => {
      const trackerById = Boolean(
        document.querySelector('[data-testid="bills-tracker-title"]')
      );
      const trackerByHeading = Array.from(document.querySelectorAll("h2")).some(
        (node) => node.textContent?.trim() === "Bills Tracker"
      );
      const accountLocked = Boolean(
        document.querySelector('[data-testid="account-locked-card"]')
      );
      if (trackerById || trackerByHeading) return "tracker";
      if (accountLocked) return "account-locked";
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

async function runViewportCheck(
  browser,
  viewport,
  baseUrl,
  { authStorageState = null, requireExternalAccount = false } = {}
) {
  const host = String(new URL(baseUrl).hostname || "");
  const isExternalHost = !isLoopbackHost(host);
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.width <= 700,
    hasTouch: viewport.width <= 1024,
    ...(authStorageState ? { storageState: authStorageState } : {}),
  });
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    await seedData(page);
    await page.reload({ waitUntil: "domcontentloaded" });

    let readyState = await waitForTrackerOrAccountLocked(page, 12_000);
    if (readyState === "account-locked" && isExternalHost && requireExternalAccount) {
      await page.waitForTimeout(400);
      await page.reload({ waitUntil: "domcontentloaded" });
      readyState = await waitForTrackerOrAccountLocked(page, 12_000);
    }

    if (readyState === "account-locked") {
      if (isExternalHost) {
        const note = "Responsive bill-flow checks skipped: deployed app remained account-locked.";
        if (requireExternalAccount) {
          return {
            ...viewport,
            status: "fail",
            error: note,
          };
        }
        return {
          ...viewport,
          status: "skip",
          note,
        };
      }
      throw new Error("Bills tracker did not unlock after seeded local session.");
    }

    await assertNoHorizontalOverflow(page, `${viewport.name}: root`);

    await openAccountModal(page);
    await assertAccountModalResponsive(page, viewport.width, viewport.name);
    await assertNoHorizontalOverflow(page, `${viewport.name}: root after account modal`);

    await clickFirstVisible(
      page,
      [
        page.getByTestId("open-settings-button-desktop").first(),
        page.getByTestId("open-settings-button-mobile").first(),
        page.locator('button[aria-label="Open settings"]:visible').first(),
      ],
      "Open settings button"
    );
    await assertElementFitsWidth(
      page,
      ".settingsModal",
      viewport.width,
      `${viewport.name}: settings modal`
    );
    await assertNoHorizontalOverflow(page, `${viewport.name}: settings open`);
    const settingsModal = page.locator(".settingsModal").first();

    const compactToggleLabel = settingsModal
      .locator('label[aria-label="Toggle compact mode"]')
      .first();
    const compactToggleInput = compactToggleLabel.locator("input").first();
    const compactBefore = await compactToggleInput.isChecked();

    await compactToggleLabel.click({ force: true });
    await waitForAssertion(async () => {
      const className = await getAppClassName(page);
      assert.equal(
        className.includes("compactMode"),
        !compactBefore,
        "compact mode class did not toggle"
      );
    }, `${viewport.name}: compact mode toggles on settings`);

    await compactToggleLabel.click({ force: true });
    await waitForAssertion(async () => {
      const className = await getAppClassName(page);
      assert.equal(
        className.includes("compactMode"),
        compactBefore,
        "compact mode class did not restore"
      );
    }, `${viewport.name}: compact mode restores`);

    await settingsModal.getByRole("button", { name: /^Compact$/i }).first().click();
    await waitForAssertion(async () => {
      const className = await getAppClassName(page);
      assert.ok(
        className.includes("density-compact"),
        "table density class did not change to compact"
      );
    }, `${viewport.name}: table density switches to compact`);

    await settingsModal
      .getByRole("button", { name: /^Comfortable$/i })
      .first()
      .click();
    await waitForAssertion(async () => {
      const className = await getAppClassName(page);
      assert.ok(
        className.includes("density-comfortable"),
        "table density class did not restore to comfortable"
      );
    }, `${viewport.name}: table density restores to comfortable`);

    await page.locator('button[aria-label="Close settings"]:visible').first().click();

    await openFirstBillDetails(page, viewport.name);
    await assertElementFitsWidth(
      page,
      ".modal.modal-lg",
      viewport.width,
      `${viewport.name}: details modal`
    );
    await assertNoHorizontalOverflow(page, `${viewport.name}: details open`);

    const detailsModal = page.locator(".modal.modal-lg").first();
    await detailsModal.getByRole("button", { name: /^Overview$/i }).first().click();

    const paymentsBeforeRaw = await getDetailsStatValue(page, "Payments");
    const paymentsBefore = Number(paymentsBeforeRaw);
    assert.ok(
      Number.isFinite(paymentsBefore),
      `${viewport.name}: could not read payment count in details`
    );
    const dueMetaBefore = await getDetailsHeaderMeta(page);
    assert.ok(dueMetaBefore, `${viewport.name}: could not read details header meta`);

    await detailsModal.getByRole("button", { name: /^Mark paid$/i }).first().click();

    const markedToast = page.locator(".undoToast").filter({ hasText: "Marked as paid" }).first();
    await markedToast.waitFor({ state: "visible", timeout: 10_000 });

    await waitForAssertion(async () => {
      const nowRaw = await getDetailsStatValue(page, "Payments");
      assert.equal(
        Number(nowRaw),
        paymentsBefore + 1,
        `expected payment count ${paymentsBefore + 1}, got ${nowRaw}`
      );
    }, `${viewport.name}: mark paid increments payment count`);

    await waitForAssertion(async () => {
      const dueMetaAfter = await getDetailsHeaderMeta(page);
      assert.notEqual(
        dueMetaAfter,
        dueMetaBefore,
        "due header did not change after mark paid"
      );
    }, `${viewport.name}: mark paid advances due cycle`);

    await clickUndoForToast(page, "Marked as paid", `${viewport.name}: undo mark paid click`);

    await waitForAssertion(async () => {
      const nowRaw = await getDetailsStatValue(page, "Payments");
      assert.equal(
        Number(nowRaw),
        paymentsBefore,
        `expected payment count ${paymentsBefore}, got ${nowRaw}`
      );
      const dueMetaNow = await getDetailsHeaderMeta(page);
      assert.equal(dueMetaNow, dueMetaBefore, "undo did not restore due header");
    }, `${viewport.name}: undo restores mark paid`);

    await detailsModal.getByRole("button", { name: /^Payments$/i }).first().click();
    const paymentRowsBefore = await getPaymentHistoryCount(page);
    await detailsModal
      .getByRole("button", { name: /^\+ Add payment$/i })
      .first()
      .click();

    const paymentToast = page.locator(".undoToast").filter({ hasText: "Payment added" }).first();
    await paymentToast.waitFor({ state: "visible", timeout: 10_000 });

    await waitForAssertion(async () => {
      const nowRows = await getPaymentHistoryCount(page);
      assert.equal(
        nowRows,
        paymentRowsBefore + 1,
        `expected payment history count ${paymentRowsBefore + 1}, got ${nowRows}`
      );
    }, `${viewport.name}: add payment adds history row`);

    await clickUndoForToast(page, "Payment added", `${viewport.name}: undo payment add click`);

    await waitForAssertion(async () => {
      const nowRows = await getPaymentHistoryCount(page);
      assert.equal(
        nowRows,
        paymentRowsBefore,
        `expected payment history count ${paymentRowsBefore}, got ${nowRows}`
      );
    }, `${viewport.name}: undo restores payment history`);

    const firstBillName = await getFirstBillName(page);
    assert.ok(firstBillName, `${viewport.name}: could not read first bill name`);

    await detailsModal.getByRole("button", { name: /^Overview$/i }).first().click();
    await detailsModal.getByRole("button", { name: /^Edit$/i }).first().click();

    await assertElementFitsWidth(
      page,
      ".billEditorModal",
      viewport.width,
      `${viewport.name}: editor modal`
    );
    await assertNoHorizontalOverflow(page, `${viewport.name}: editor open`);

    const editorModal = page.locator(".billEditorModal").first();
    const nextName = `${firstBillName} QA`;
    await editorModal.getByPlaceholder("e.g., Water & Sewer").first().fill(nextName);
    await editorModal.getByRole("button", { name: /^Save$/i }).first().click();

    await editorModal.waitFor({ state: "hidden", timeout: 12_000 });
    const billUpdatedToast = page
      .locator(".undoToast")
      .filter({ hasText: "Bill updated" })
      .first();
    await billUpdatedToast.waitFor({ state: "visible", timeout: 10_000 });

    await waitForAssertion(async () => {
      const currentName = await getFirstBillName(page);
      assert.equal(currentName, nextName, `expected first bill name "${nextName}"`);
    }, `${viewport.name}: edit save updates row content`);

    await clickUndoForToast(page, "Bill updated", `${viewport.name}: undo bill edit click`);

    await waitForAssertion(async () => {
      const currentName = await getFirstBillName(page);
      assert.equal(
        currentName,
        firstBillName,
        `expected first bill name restored to "${firstBillName}"`
      );
    }, `${viewport.name}: undo restores edited bill`);

    await assertNoHorizontalOverflow(page, `${viewport.name}: final root`);

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
  const externalBaseUrlRaw = String(process.env.RESPONSIVE_BASE_URL || "").trim();
  const targetViewports = selectViewports();
  const resultsFile = String(process.env.RESPONSIVE_RESULTS_FILE || "").trim();
  const isExternalRun = externalBaseUrlRaw.length > 0;
  const baseUrl = isExternalRun
    ? normalizeBaseUrl(externalBaseUrlRaw)
    : `http://${HOST}:${await findFreePort(HOST)}`;

  let preview = null;
  let browser = null;
  const results = [];
  const requireExternalAccount =
    isExternalRun && String(process.env.E2E_REQUIRE_ACCOUNT || "").trim() === "1";
  let authStorageState = null;
  let seededExternalAccount = { created: false, password: "" };

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
      const port = new URL(baseUrl).port;
      preview = startPreviewServer(Number(port));
    }

    await waitForServer(baseUrl);
    browser = await chromium.launch({ headless: true });

    if (isExternalRun) {
      const authContext = await browser.newContext({
        baseURL: baseUrl,
        viewport: { width: 1366, height: 768 },
      });
      const authPage = await authContext.newPage();
      await authPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
      const authResult = await ensureAuthenticatedSession(authPage, {
        label: "responsive-shared",
        strict: requireExternalAccount,
      });
      if (authResult.status !== "pass") {
        await authContext.close();
        if (authResult.status === "fail") {
          throw new Error(authResult.reason);
        }
        for (const vp of targetViewports) {
          results.push({
            ...vp,
            status: "skip",
            note: `Responsive bill-flow checks skipped: ${authResult.reason}`,
          });
        }
      } else {
        authStorageState = await authContext.storageState();
        seededExternalAccount = authResult;
        await authContext.close();
      }
    }

    console.log(
      `Running responsive checks on ${targetViewports.length} viewport(s) [${
        isExternalRun ? "external preview" : "local preview"
      }]${
        process.env.RESPONSIVE_VIEWPORTS ? ` [${process.env.RESPONSIVE_VIEWPORTS}]` : ""
      }...`
    );

    if (results.length === 0) {
      for (const vp of targetViewports) {
        console.log(`Checking ${vp.name} (${vp.width}x${vp.height})...`);
        const outcome = await runViewportCheck(browser, vp, baseUrl, {
          authStorageState,
          requireExternalAccount,
        });
        results.push(outcome);
      }
    }

    console.log("\nResponsive matrix results:");
    for (const r of results) {
      if (r.status === "pass") {
        console.log(`PASS  ${r.name} (${r.width}x${r.height})`);
      } else if (r.status === "skip") {
        console.log(`SKIP  ${r.name} (${r.width}x${r.height}) -> ${r.note}`);
      } else {
        console.log(`FAIL  ${r.name} (${r.width}x${r.height}) -> ${r.error}`);
      }
    }

    const failed = results.filter((r) => r.status === "fail");
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    if (resultsFile) {
      try {
        await fs.writeFile(
          resultsFile,
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              baseUrl,
              viewports: targetViewports,
              results,
            },
            null,
            2
          ),
          "utf8"
        );
      } catch {
        // Best-effort diagnostics only.
      }
    }

    if (browser && isExternalRun && seededExternalAccount.created && authStorageState) {
      const cleanupContext = await browser.newContext({
        baseURL: baseUrl,
        storageState: authStorageState,
      });
      const cleanupPage = await cleanupContext.newPage();
      await cleanupPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await deleteCreatedAccountIfNeeded(cleanupPage, seededExternalAccount);
      await cleanupContext.close();
    }

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

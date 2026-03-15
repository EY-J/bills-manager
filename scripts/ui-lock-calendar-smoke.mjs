#!/usr/bin/env node
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
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
const E2E_UNLOCK_KEY = "__bills_e2e_unlock_session_v1";
const ACCOUNT_KNOWN_KEY = "bills_account_known_v1";

function toISODate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function seedPayload() {
  const today = toISODate(new Date());
  const upcoming = toISODate(Date.now() + 3 * 24 * 60 * 60 * 1000);
  return {
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    data: {
      bills: [
        {
          id: "ui-smoke-today",
          name: "Water bill",
          category: "Utilities",
          dueDate: today,
          amount: 1200,
          notes: "UI smoke seeded bill",
          payments: [],
          cadence: "monthly",
          reminderDays: 3,
          totalMonths: 0,
          paidMonths: 0,
          cyclePaidAmount: 0,
          archived: false,
        },
        {
          id: "ui-smoke-upcoming",
          name: "Internet bill",
          category: "Utilities",
          dueDate: upcoming,
          amount: 1800,
          notes: "UI smoke seeded bill",
          payments: [],
          cadence: "monthly",
          reminderDays: 2,
          totalMonths: 0,
          paidMonths: 0,
          cyclePaidAmount: 0,
          archived: false,
        },
      ],
    },
  };
}

function resolveNpmInvocation(args) {
  if (NPM_EXEC_PATH) {
    return { command: process.execPath, argv: [NPM_EXEC_PATH, ...args] };
  }
  return { command: NPM_FALLBACK_CMD, argv: args };
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

function runNpm(args, label) {
  const { command, argv } = resolveNpmInvocation(args);
  return runCommand(command, argv, label);
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
  return spawn(command, argv, SPAWN_OPTIONS);
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
      throw new Error("UI smoke base URL must use http or https.");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid UI_SMOKE_BASE_URL: ${msg}`);
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

async function waitForCondition(assertion, label, timeoutMs = 8_000) {
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
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label}: ${detail}`);
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

async function assertContainerScrollsIfNeeded(page, selector, label) {
  const metrics = await page.evaluate((targetSelector) => {
    const node = document.querySelector(targetSelector);
    if (!(node instanceof HTMLElement)) return null;

    const hasOverflow = node.scrollHeight > node.clientHeight + 1;
    if (!hasOverflow) {
      return { hasOverflow: false, scrollTopAfter: 0 };
    }

    node.scrollTop = Math.max(1, node.scrollHeight - node.clientHeight);
    return { hasOverflow: true, scrollTopAfter: node.scrollTop };
  }, selector);

  assert.ok(metrics, `${label}: missing container ${selector}`);
  if (!metrics.hasOverflow) return;
  assert.ok(
    Number(metrics.scrollTopAfter) > 0,
    `${label}: container did not scroll despite overflow`
  );
}

async function waitForTrackerOrAccountLocked(page, timeoutMs = 12_000) {
  const started = Date.now();
  let sawAccountLocked = false;
  while (Date.now() - started < timeoutMs) {
    const state = await page.evaluate(() => {
      const trackerVisible = Boolean(
        document.querySelector('[data-testid="bills-tracker-title"]')
      );
      const accountLockedVisible = Boolean(
        document.querySelector('[data-testid="account-locked-card"]')
      );
      if (trackerVisible) return "tracker";
      if (accountLockedVisible) return "account-locked";
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

async function runAccountLockedDesktopCheck(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ unlockKey, knownKey }) => {
      localStorage.clear();
      localStorage.removeItem(unlockKey);
      localStorage.removeItem(knownKey);
    },
    { unlockKey: E2E_UNLOCK_KEY, knownKey: ACCOUNT_KNOWN_KEY }
  );
  await page.reload({ waitUntil: "domcontentloaded" });

  const lockedCard = page.getByTestId("account-locked-card").first();
  await lockedCard.waitFor({ state: "visible", timeout: 12_000 });
  await page.getByTestId("account-locked-create-button").first().waitFor({ state: "visible" });
  await page.getByTestId("account-locked-signin-button").first().waitFor({ state: "visible" });

  await page.getByTestId("account-locked-signin-button").first().click();
  const modal = page.getByTestId("account-modal").first();
  await modal.waitFor({ state: "visible", timeout: 8_000 });
  await modal.getByTestId("account-auth-mode-signin").first().waitFor({
    state: "visible",
    timeout: 6_000,
  });
  await modal.getByTestId("account-close-button").first().click();
  await modal.waitFor({ state: "hidden", timeout: 8_000 });
}

async function runCalendarMobileDialogCheck(
  page,
  { allowAccountLockedSkip = false, requireExternalAccount = false } = {}
) {
  const payload = seedPayload();
  const todayIso = payload.data.bills[0].dueDate;
  let createdAccount = { created: false, password: "" };

  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (allowAccountLockedSkip) {
      const authResult = await ensureAuthenticatedSession(page, {
        label: "ui-mobile",
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
          note: `Calendar mobile checks skipped: ${authResult.reason}`,
        };
      }
      createdAccount = authResult;
    }

    await page.evaluate(
      ({ data, unlockKey, knownKey }) => {
        localStorage.clear();
        localStorage.setItem("bills_manager_v1", JSON.stringify(data));
        localStorage.setItem("bills_notify_enabled", "false");
        localStorage.setItem("bills_compact_mode", "false");
        localStorage.setItem("bills_table_density", "comfortable");
        localStorage.setItem("bills_notify_mode", "digest");
        localStorage.setItem(unlockKey, "1");
        localStorage.setItem(knownKey, "1");
      },
      { data: payload, unlockKey: E2E_UNLOCK_KEY, knownKey: ACCOUNT_KNOWN_KEY }
    );
    await page.reload({ waitUntil: "domcontentloaded" });

    const readyState = await waitForTrackerOrAccountLocked(page, 12_000);
    if (readyState === "account-locked") {
      if (allowAccountLockedSkip) {
        return {
          status: "skip",
          note:
            "Calendar mobile checks skipped: deployed app remained account-locked after auth setup.",
        };
      }
      throw new Error("Bills tracker did not unlock after seeded local session.");
    }

    await page.getByTestId("mobile-nav-calendar").first().click();
    const calendarDialog = page.getByTestId("calendar-dialog").first();
    await calendarDialog.waitFor({ state: "visible", timeout: 8_000 });
    const viewport = page.viewportSize();
    assert.ok(viewport, "Missing viewport size for mobile calendar check");
    await assertElementFitsWidth(
      page,
      '[data-testid="calendar-dialog"]',
      viewport.width,
      "Mobile calendar dialog width"
    );
    await assertNoHorizontalOverflow(page, "Mobile calendar open");

    const dueDay = page.getByTestId(`calendar-day-${todayIso}`).first();
    await dueDay.waitFor({ state: "visible", timeout: 8_000 });
    await dueDay.click();
    await dueDay.locator(".calendarDayItemText").first().waitFor({
      state: "visible",
      timeout: 8_000,
    });

    await assertContainerScrollsIfNeeded(
      page,
      ".calendarScheduleList",
      "Mobile calendar month overview list"
    );

    return { status: "pass" };
  } finally {
    await deleteCreatedAccountIfNeeded(page, createdAccount);
  }
}

async function main() {
  const externalBaseUrlRaw = String(process.env.UI_SMOKE_BASE_URL || "").trim();
  const isExternalRun = externalBaseUrlRaw.length > 0;
  const baseUrl = isExternalRun
    ? normalizeBaseUrl(externalBaseUrlRaw)
    : `http://${HOST}:${await findFreePort(HOST)}`;

  let preview = null;
  let browser = null;

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

    {
      const desktop = await browser.newContext({
        baseURL: baseUrl,
        viewport: { width: 1366, height: 768 },
      });
      const page = await desktop.newPage();
      console.log("Checking account-required onboarding card (desktop)...");
      await runAccountLockedDesktopCheck(page);
      await desktop.close();
    }

    {
      const mobile = await browser.newContext({
        baseURL: baseUrl,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await mobile.newPage();
      console.log("Checking calendar modal responsive behavior (mobile)...");
      const mobileResult = await runCalendarMobileDialogCheck(page, {
        allowAccountLockedSkip: isExternalRun,
        requireExternalAccount:
          isExternalRun && String(process.env.E2E_REQUIRE_ACCOUNT || "").trim() === "1",
      });
      if (mobileResult.status === "fail") {
        throw new Error(mobileResult.error || "Mobile calendar legend checks failed.");
      }
      if (mobileResult.status === "skip") {
        console.log(`SKIP  mobile calendar legend checks -> ${mobileResult.note}`);
      }
      await mobile.close();
    }

    console.log("UI lock + calendar smoke checks passed.");
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopPreviewProcess(preview);
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

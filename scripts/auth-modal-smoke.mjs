#!/usr/bin/env node
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
  { name: "desktop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];

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
      throw new Error("Auth smoke base URL must use http or https.");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid AUTH_E2E_BASE_URL: ${msg}`);
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

async function runAuthModalChecks(page, viewportName) {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const accountOpenDeadline = Date.now() + 14_000;
  let opened = false;
  while (Date.now() < accountOpenDeadline && !opened) {
    const desktopOpenAccountButton = page.locator('button[aria-label^="Open account"]').first();
    if (
      (await desktopOpenAccountButton.count()) > 0 &&
      (await desktopOpenAccountButton.isVisible())
    ) {
      await desktopOpenAccountButton.click();
      opened = true;
      break;
    }

    const mobileAccountButton = page.getByRole("button", { name: /^Account$/i }).first();
    if ((await mobileAccountButton.count()) > 0 && (await mobileAccountButton.isVisible())) {
      await mobileAccountButton.click();
      opened = true;
      break;
    }

    await sleep(120);
  }

  if (!opened) {
    throw new Error("Could not find a visible Account open button.");
  }

  const modal = page.locator(".accountModal").first();
  await modal.waitFor({ state: "visible", timeout: 8_000 });
  await assertNoHorizontalOverflow(page, `${viewportName}: account modal open`);

  const primaryActionButton = modal
    .locator(".accountDataActions.is-single .settingsActionPrimary")
    .first();
  await primaryActionButton.waitFor({ state: "visible", timeout: 4_000 });
  assert.equal(await primaryActionButton.isDisabled(), true);

  const signInEmailInput = modal.locator('input[aria-label="Email"]').first();
  const signInPasswordInput = modal.locator('input[aria-label="Password"]').first();
  await signInEmailInput.fill("smoke.user@example.com");
  await signInPasswordInput.fill("weak-pass-123");

  await waitForCondition(async () => {
    assert.equal(await primaryActionButton.isDisabled(), false);
  }, `${viewportName}: sign-in button should enable with email+password`);

  await modal.locator(".settingsPillCreate").first().click();
  const createEmailInput = modal.locator('input[aria-label="Email"]').first();
  const createPasswordInput = modal.locator('input[aria-label="Password"]').first();
  const confirmPasswordInput = modal.locator('input[aria-label="Re-enter password"]').first();
  await createEmailInput.fill("create.user@example.com");
  await createPasswordInput.fill("weak-pass-123");
  await confirmPasswordInput.fill("weak-pass-123");

  await waitForCondition(async () => {
    assert.equal(await primaryActionButton.isDisabled(), true);
  }, `${viewportName}: create account button should remain disabled for weak password`);

  await createPasswordInput.fill("Strong-pass-123");
  await confirmPasswordInput.fill("Strong-pass-123");
  await waitForCondition(async () => {
    assert.equal(await primaryActionButton.isDisabled(), false);
  }, `${viewportName}: create account button should enable for valid password`);

  await modal.locator(".settingsPillSignIn").first().click();
  await modal.locator(".accountAssistBtn").filter({ hasText: "Forgot password?" }).first().click();

  const resetActionButton = modal
    .locator(".accountDataActions.is-single .settingsActionPrimary")
    .first();
  await waitForCondition(async () => {
    await resetActionButton.waitFor({ state: "visible", timeout: 3_000 });
  }, `${viewportName}: reset action button visible`);

  const resetEmailInput = modal.locator('input[aria-label="Email"]').first();
  await resetEmailInput.fill("");
  await waitForCondition(async () => {
    assert.equal(await resetActionButton.isDisabled(), true);
  }, `${viewportName}: reset link button disabled without email`);

  await resetEmailInput.fill("reset.user@example.com");
  await waitForCondition(async () => {
    assert.equal(await resetActionButton.isDisabled(), false);
  }, `${viewportName}: reset link button enabled with email`);
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
    await runAuthModalChecks(page, viewport.name);
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
  const externalBaseUrlRaw = String(process.env.AUTH_E2E_BASE_URL || "").trim();
  const isExternalRun = externalBaseUrlRaw.length > 0;
  const baseUrl = isExternalRun
    ? normalizeBaseUrl(externalBaseUrlRaw)
    : `http://${HOST}:${await findFreePort(HOST)}`;

  let preview = null;
  let browser = null;
  const results = [];

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

    console.log(
      `Running auth modal smoke checks on ${VIEWPORTS.length} viewport(s) [${
        isExternalRun ? "external preview" : "local preview"
      }]...`
    );

    for (const viewport of VIEWPORTS) {
      console.log(`Checking ${viewport.name} (${viewport.width}x${viewport.height})...`);
      const result = await runViewportCheck(browser, viewport, baseUrl);
      results.push(result);
    }

    console.log("\nAuth modal smoke results:");
    for (const item of results) {
      if (item.status === "pass") {
        console.log(`PASS  ${item.name} (${item.width}x${item.height})`);
      } else {
        console.log(`FAIL  ${item.name} (${item.width}x${item.height}) -> ${item.error}`);
      }
    }

    const failed = results.filter((item) => item.status === "fail");
    if (failed.length > 0) {
      process.exitCode = 1;
    }
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

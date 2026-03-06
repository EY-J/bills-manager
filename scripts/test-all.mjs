#!/usr/bin/env node

import { spawn } from "node:child_process";

const NPM_EXEC_PATH = String(process.env.npm_execpath || "").trim();
const NPM_FALLBACK_CMD = process.platform === "win32" ? "npm.cmd" : "npm";
const SPAWN_OPTIONS = {
  stdio: "inherit",
  shell: false,
};

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
    throw new Error(`Invalid TEST_ALL_BASE_URL: ${msg}`);
  }
}

function runNpm(args, label, extraEnv = {}) {
  const { command, argv } = resolveNpmInvocation(args);
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      ...SPAWN_OPTIONS,
      env: { ...process.env, ...extraEnv },
    });
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

async function main() {
  const externalBaseUrlRaw = String(process.env.TEST_ALL_BASE_URL || "").trim();
  const externalBaseUrl = externalBaseUrlRaw
    ? normalizeBaseUrl(externalBaseUrlRaw)
    : "";

  const sharedSmokeEnv = {
    SKIP_BUILD: "1",
    OFFLINE_POLICY: String(process.env.OFFLINE_POLICY || "enabled"),
  };

  if (externalBaseUrl) {
    Object.assign(sharedSmokeEnv, {
      AUTH_E2E_BASE_URL: externalBaseUrl,
      E2E_REQUIRE_ACCOUNT: String(process.env.E2E_REQUIRE_ACCOUNT || "1"),
      E2E_BASE_URL: externalBaseUrl,
      OFFLINE_BASE_URL: externalBaseUrl,
      RESPONSIVE_BASE_URL: externalBaseUrl,
      SW_BASE_URL: externalBaseUrl,
      UI_SMOKE_BASE_URL: externalBaseUrl,
    });
  }

  console.log(
    `Running full test pipeline [${
      externalBaseUrl ? `external: ${externalBaseUrl}` : "local preview"
    }]...`
  );

  if (!externalBaseUrl) {
    console.log(
      "Note: service worker checks can skip on localhost. For full SW/offline coverage use TEST_ALL_BASE_URL=https://<preview-url>."
    );
  }

  const steps = [
    { label: "Lint", args: ["run", "lint"] },
    { label: "Unit tests", args: ["run", "test"] },
    { label: "Production build", args: ["run", "build"] },
    { label: "Auth smoke", args: ["run", "test:e2e:auth"], env: sharedSmokeEnv },
    { label: "UI smoke", args: ["run", "test:e2e:ui"], env: sharedSmokeEnv },
    { label: "Responsive smoke", args: ["run", "test:responsive"], env: sharedSmokeEnv },
    { label: "Offline smoke", args: ["run", "test:offline"], env: sharedSmokeEnv },
    { label: "SW upgrade smoke", args: ["run", "test:sw-upgrade"], env: sharedSmokeEnv },
    { label: "Critical E2E", args: ["run", "test:e2e:critical"], env: sharedSmokeEnv },
  ];

  for (const step of steps) {
    console.log(`\n==> ${step.label}`);
    await runNpm(step.args, step.label, step.env || {});
  }

  console.log("\nAll checks passed.");
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(msg);
  process.exit(1);
});

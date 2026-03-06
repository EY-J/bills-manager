#!/usr/bin/env node

import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_PASSWORD = "Strong-pass-123";

function parseRetryAfterSeconds(rawHeader) {
  const raw = String(rawHeader || "").trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(1, Math.ceil(seconds));
  }
  const parsedDate = Date.parse(raw);
  if (!Number.isNaN(parsedDate)) {
    const deltaMs = parsedDate - Date.now();
    if (deltaMs > 0) {
      return Math.max(1, Math.ceil(deltaMs / 1000));
    }
  }
  return 0;
}

function solveChallengePrompt(prompt) {
  const text = String(prompt || "");
  const match = text.match(/(\d+)\s*\+\s*(\d+)/);
  if (!match) return "";
  return String(Number(match[1]) + Number(match[2]));
}

function randomEmail(label) {
  const safeLabel = String(label || "e2e")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "e2e";
  const token = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  return `${safeLabel}-${token}@example.com`;
}

async function requestAuth(page, { method, body = null }) {
  return page.evaluate(
    async ({ requestMethod, requestBody }) => {
      try {
        const response = await fetch("/api/account-auth", {
          method: requestMethod,
          credentials: "include",
          headers: requestBody ? { "Content-Type": "application/json" } : undefined,
          body: requestBody ? JSON.stringify(requestBody) : undefined,
        });
        let data = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        return {
          ok: response.ok,
          status: response.status,
          retryAfter: response.headers.get("Retry-After") || "",
          data,
          error: "",
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          retryAfter: "",
          data: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      requestMethod: method,
      requestBody: body,
    }
  );
}

function authFailureResult({ strict, reason }) {
  if (strict) {
    return { status: "fail", reason };
  }
  return { status: "skip", reason };
}

export async function ensureAuthenticatedSession(
  page,
  {
    label = "e2e",
    strict = false,
    maxAttempts = 3,
  } = {}
) {
  const existingSession = await requestAuth(page, { method: "GET" });
  if (existingSession.ok && existingSession.data?.user?.id) {
    return {
      status: "pass",
      created: false,
      password: "",
      email: String(existingSession.data.user.email || ""),
    };
  }

  let lastReason = "Could not create external account session.";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const email = randomEmail(`${label}-${attempt}`);
    const password = DEFAULT_PASSWORD;

    let signupResponse = await requestAuth(page, {
      method: "POST",
      body: {
        action: "signup",
        email,
        password,
      },
    });

    if (signupResponse.status === 428 && signupResponse.data?.challengeRequired) {
      const challengeToken = String(signupResponse.data.challengeToken || "");
      const challengePrompt = String(signupResponse.data.challengePrompt || "");
      const challengeAnswer = solveChallengePrompt(challengePrompt);
      if (!challengeToken || !challengeAnswer) {
        lastReason = "Auth challenge could not be solved in E2E runner.";
        continue;
      }
      signupResponse = await requestAuth(page, {
        method: "POST",
        body: {
          action: "signup",
          email,
          password,
          challengeToken,
          challengeAnswer,
        },
      });
    }

    if (signupResponse.ok && signupResponse.data?.user?.id) {
      return {
        status: "pass",
        created: true,
        password,
        email,
      };
    }

    if (signupResponse.status === 409) {
      lastReason = "Generated E2E account email already exists.";
      continue;
    }

    if (signupResponse.status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(signupResponse.retryAfter);
      if (retryAfterSeconds > 0) {
        await sleep(Math.min(retryAfterSeconds, 8) * 1000);
      }
      lastReason =
        String(signupResponse.data?.error || "").trim() ||
        "Auth endpoint rate limited.";
      continue;
    }

    const serverError = String(signupResponse.data?.error || "").trim();
    if (signupResponse.status === 503) {
      return authFailureResult({
        strict,
        reason:
          serverError || "Cloud account storage is not configured in deployment.",
      });
    }

    lastReason =
      serverError ||
      signupResponse.error ||
      `Unexpected auth signup failure (status ${signupResponse.status || "unknown"}).`;
  }

  return authFailureResult({
    strict,
    reason: lastReason,
  });
}

export async function deleteCreatedAccountIfNeeded(page, { created, password }) {
  if (!created || !password) return;
  await requestAuth(page, {
    method: "POST",
    body: {
      action: "delete-account",
      password,
    },
  });
}

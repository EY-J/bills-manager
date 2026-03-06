import test from "node:test";
import assert from "node:assert/strict";

function createRequest({
  method = "POST",
  headers = {},
  body = null,
  remoteAddress = "127.0.0.1",
} = {}) {
  return {
    method,
    headers,
    body,
    socket: { remoteAddress },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = Number(code);
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

async function loadHandler() {
  const cacheBuster = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const mod = await import(`../api/account-auth.js?cache=${cacheBuster}`);
  return mod.default;
}

function authHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    host: "app.local",
    ...extra,
  };
}

function solveChallengePrompt(prompt) {
  const text = String(prompt || "");
  const match = text.match(/(\d+)\s*\+\s*(\d+)/);
  if (!match) return "";
  return String(Number(match[1]) + Number(match[2]));
}

function uniqueTestIp() {
  const seed = Date.now() + Math.floor(Math.random() * 10_000);
  const octet3 = (Math.floor(seed / 256) % 254) + 1;
  const octet4 = (seed % 254) + 1;
  return `198.18.${octet3}.${octet4}`;
}

test("account auth signup -> session -> logout flow", async () => {
  const handler = await loadHandler();
  const email = `user_${Date.now()}@example.com`;
  const password = "Strong-pass-123";

  const signupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password,
    },
  });
  const signupRes = createResponse();
  await handler(signupReq, signupRes);
  assert.equal(signupRes.statusCode, 200);
  assert.equal(signupRes.body?.ok, true);
  assert.equal(signupRes.body?.user?.email, email.toLowerCase());
  const cookie = String(signupRes.headers["set-cookie"] || "");
  assert.match(cookie, /bills_account_session=/i);

  const sessionReq = createRequest({
    method: "GET",
    headers: {
      host: "app.local",
      cookie,
    },
  });
  const sessionRes = createResponse();
  await handler(sessionReq, sessionRes);
  assert.equal(sessionRes.statusCode, 200);
  assert.equal(sessionRes.body?.ok, true);
  assert.equal(sessionRes.body?.user?.email, email.toLowerCase());

  const logoutReq = createRequest({
    method: "POST",
    headers: authHeaders({ cookie }),
    body: { action: "logout" },
  });
  const logoutRes = createResponse();
  await handler(logoutReq, logoutRes);
  assert.equal(logoutRes.statusCode, 200);
  assert.equal(logoutRes.body?.ok, true);
  assert.match(String(logoutRes.headers["set-cookie"] || ""), /Max-Age=0/i);
});

test("account auth direct signup creates session without verification code", async () => {
  const handler = await loadHandler();
  const email = `direct_${Date.now()}@example.com`;
  const password = "Direct-pass-123";

  const signupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password,
    },
  });
  const signupRes = createResponse();
  await handler(signupReq, signupRes);
  assert.equal(signupRes.statusCode, 200);
  assert.equal(signupRes.body?.ok, true);
  assert.equal(signupRes.body?.user?.email, email.toLowerCase());
  assert.match(String(signupRes.headers["set-cookie"] || ""), /bills_account_session=/i);
});

test("account auth signup rejects weak password that misses uppercase", async () => {
  const handler = await loadHandler();
  const email = `weak_${Date.now()}@example.com`;

  const signupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password: "weak-pass-123",
    },
  });
  const signupRes = createResponse();
  await handler(signupReq, signupRes);
  assert.equal(signupRes.statusCode, 422);
  assert.equal(
    signupRes.body?.error,
    "Password must include uppercase, lowercase, and a number."
  );
});

test("account auth rejects invalid login", async () => {
  const handler = await loadHandler();
  const email = `user_${Date.now()}@example.com`;
  const password = "Strong-pass-123";

  const signupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password,
    },
  });
  const signupRes = createResponse();
  await handler(signupReq, signupRes);
  assert.equal(signupRes.statusCode, 200);

  const loginReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "login",
      email,
      password: "wrong-password",
    },
  });
  const loginRes = createResponse();
  await handler(loginReq, loginRes);
  assert.equal(loginRes.statusCode, 401);
  assert.equal(loginRes.body?.ok, false);
});

test("account auth rejects unknown account login with generic credentials error", async () => {
  const handler = await loadHandler();
  const email = `missing_${Date.now()}@example.com`;

  const loginReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "login",
      email,
      password: "Strong-pass-123",
    },
  });
  const loginRes = createResponse();
  await handler(loginReq, loginRes);
  assert.equal(loginRes.statusCode, 401);
  assert.equal(loginRes.body?.ok, false);
  assert.equal(loginRes.body?.error, "Invalid email or password.");
});

test("account auth rejects removed signup-code actions", async () => {
  const handler = await loadHandler();

  const requestCodeReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "request-signup-code",
      email: `legacy_${Date.now()}@example.com`,
    },
  });
  const requestCodeRes = createResponse();
  await handler(requestCodeReq, requestCodeRes);
  assert.equal(requestCodeRes.statusCode, 422);
  assert.equal(requestCodeRes.body?.ok, false);
  assert.match(String(requestCodeRes.body?.error || ""), /unsupported auth action/i);

  const completeReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "complete-signup",
      email: `legacy_complete_${Date.now()}@example.com`,
      password: "Strong-pass-123",
      code: "000000",
    },
  });
  const completeRes = createResponse();
  await handler(completeReq, completeRes);
  assert.equal(completeRes.statusCode, 422);
  assert.equal(completeRes.body?.ok, false);
  assert.match(String(completeRes.body?.error || ""), /unsupported auth action/i);
});

test("account auth recovery code reset updates login credentials without email delivery", async () => {
  const handler = await loadHandler();
  const email = `recover_${Date.now()}@example.com`;
  const oldPassword = "Strong-pass-123";
  const newPassword = "Recover-pass-456";

  const signupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password: oldPassword,
    },
  });
  const signupRes = createResponse();
  await handler(signupReq, signupRes);
  assert.equal(signupRes.statusCode, 200);
  assert.equal(signupRes.body?.ok, true);
  assert.match(String(signupRes.body?.recoveryCode || ""), /^\d{4}-\d{4}-\d{4}$/);

  const recoverReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "complete-password-reset-recovery",
      email,
      recoveryCode: signupRes.body?.recoveryCode,
      password: newPassword,
    },
  });
  const recoverRes = createResponse();
  await handler(recoverReq, recoverRes);
  assert.equal(recoverRes.statusCode, 200);
  assert.equal(recoverRes.body?.ok, true);

  const oldLoginReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "login",
      email,
      password: oldPassword,
    },
  });
  const oldLoginRes = createResponse();
  await handler(oldLoginReq, oldLoginRes);
  assert.equal(oldLoginRes.statusCode, 401);

  const newLoginReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "login",
      email,
      password: newPassword,
    },
  });
  const newLoginRes = createResponse();
  await handler(newLoginReq, newLoginRes);
  assert.equal(newLoginRes.statusCode, 200);
  assert.equal(newLoginRes.body?.ok, true);
});

test("account auth login throttles repeated failed attempts per email and IP", async () => {
  const handler = await loadHandler();
  const email = `throttle_${Date.now()}@example.com`;
  const password = "Strong-pass-123";
  const lockIp = uniqueTestIp();

  const signupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password,
    },
  });
  const signupRes = createResponse();
  await handler(signupReq, signupRes);
  assert.equal(signupRes.statusCode, 200);

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const loginReq = createRequest({
      method: "POST",
      headers: authHeaders({
        "x-forwarded-for": lockIp,
      }),
      body: {
        action: "login",
        email,
        password: "Wrong-pass-123",
      },
    });
    const loginRes = createResponse();
    await handler(loginReq, loginRes);

    if (attempt < 6) {
      assert.equal(loginRes.statusCode, 401);
      assert.equal(loginRes.body?.error, "Invalid email or password.");
      continue;
    }

    assert.equal(loginRes.statusCode, 429);
    assert.match(String(loginRes.body?.error || ""), /Too many sign-in attempts/i);
    const retryAfter = Number(loginRes.headers["retry-after"] || 0);
    assert.ok(Number.isFinite(retryAfter) && retryAfter >= 1);
  }
});

test("account auth failed sign-in attempts from one IP do not block another IP", async () => {
  const handler = await loadHandler();
  const email = `signin_ip_scope_${Date.now()}@example.com`;
  const password = "Strong-pass-123";
  const blockedIp = uniqueTestIp();
  const cleanIp = uniqueTestIp();

  const signupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password,
    },
  });
  const signupRes = createResponse();
  await handler(signupReq, signupRes);
  assert.equal(signupRes.statusCode, 200);

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const failedReq = createRequest({
      method: "POST",
      headers: authHeaders({
        "x-forwarded-for": blockedIp,
      }),
      body: {
        action: "login",
        email,
        password: "Wrong-pass-123",
      },
    });
    const failedRes = createResponse();
    await handler(failedReq, failedRes);
  }

  const validReq = createRequest({
    method: "POST",
    headers: authHeaders({
      "x-forwarded-for": cleanIp,
    }),
    body: {
      action: "login",
      email,
      password,
    },
  });
  const validRes = createResponse();
  await handler(validReq, validRes);
  assert.equal(validRes.statusCode, 200);
  assert.equal(validRes.body?.ok, true);
});

test("account auth recovery reset throttles invalid attempts per email and IP", async () => {
  const handler = await loadHandler();
  const email = `recovery_limit_${Date.now()}@example.com`;
  const password = "Strong-pass-123";
  const newPassword = "Recover-pass-789";
  const recoveryIp = uniqueTestIp();
  const recoveryBypassIp = uniqueTestIp();

  const signupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password,
    },
  });
  const signupRes = createResponse();
  await handler(signupReq, signupRes);
  assert.equal(signupRes.statusCode, 200);
  assert.match(String(signupRes.body?.recoveryCode || ""), /^\d{4}-\d{4}-\d{4}$/);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const invalidRecoverReq = createRequest({
      method: "POST",
      headers: authHeaders({
        "x-forwarded-for": recoveryIp,
      }),
      body: {
        action: "complete-password-reset-recovery",
        email,
        recoveryCode: "0000-0000-0000",
        password: newPassword,
      },
    });
    const invalidRecoverRes = createResponse();
    await handler(invalidRecoverReq, invalidRecoverRes);
    assert.equal(invalidRecoverRes.statusCode, 401);
  }

  const challengeRequiredReq = createRequest({
    method: "POST",
    headers: authHeaders({
      "x-forwarded-for": recoveryIp,
    }),
    body: {
      action: "complete-password-reset-recovery",
      email,
      recoveryCode: "0000-0000-0000",
      password: newPassword,
    },
  });
  const challengeRequiredRes = createResponse();
  await handler(challengeRequiredReq, challengeRequiredRes);
  assert.equal(challengeRequiredRes.statusCode, 428);
  assert.equal(challengeRequiredRes.body?.challengeRequired, true);
  const challengeToken = String(challengeRequiredRes.body?.challengeToken || "");
  const challengePrompt = String(challengeRequiredRes.body?.challengePrompt || "");
  const challengeAnswer = solveChallengePrompt(challengePrompt);
  assert.ok(challengeToken.length > 20);
  assert.ok(challengeAnswer.length > 0);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const invalidRecoverReq = createRequest({
      method: "POST",
      headers: authHeaders({
        "x-forwarded-for": recoveryIp,
      }),
      body: {
        action: "complete-password-reset-recovery",
        email,
        recoveryCode: "0000-0000-0000",
        password: newPassword,
        challengeToken,
        challengeAnswer,
      },
    });
    const invalidRecoverRes = createResponse();
    await handler(invalidRecoverReq, invalidRecoverRes);

    if (attempt < 3) {
      assert.equal(invalidRecoverRes.statusCode, 401);
      continue;
    }
    assert.equal(invalidRecoverRes.statusCode, 429);
    assert.match(String(invalidRecoverRes.body?.error || ""), /Too many recovery attempts/i);
    const retryAfter = Number(invalidRecoverRes.headers["retry-after"] || 0);
    assert.ok(Number.isFinite(retryAfter) && retryAfter >= 1);
  }

  const blockedReq = createRequest({
    method: "POST",
    headers: authHeaders({
      "x-forwarded-for": recoveryIp,
    }),
    body: {
      action: "complete-password-reset-recovery",
      email,
      recoveryCode: signupRes.body?.recoveryCode,
      password: newPassword,
      challengeToken,
      challengeAnswer,
    },
  });
  const blockedRes = createResponse();
  await handler(blockedReq, blockedRes);
  assert.equal(blockedRes.statusCode, 429);

  const otherIpReq = createRequest({
    method: "POST",
    headers: authHeaders({
      "x-forwarded-for": recoveryBypassIp,
    }),
    body: {
      action: "complete-password-reset-recovery",
      email,
      recoveryCode: signupRes.body?.recoveryCode,
      password: newPassword,
    },
  });
  const otherIpRes = createResponse();
  await handler(otherIpReq, otherIpRes);
  assert.equal(otherIpRes.statusCode, 200);
  assert.equal(otherIpRes.body?.ok, true);
});

test("account auth requires signup challenge after repeated duplicate signups", async () => {
  const handler = await loadHandler();
  const existingEmail = `signup_challenge_existing_${Date.now()}@example.com`;
  const gatedEmail = `signup_challenge_new_${Date.now()}@example.com`;
  const password = "Strong-pass-123";
  const challengeIp = uniqueTestIp();

  const initialSignupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email: existingEmail,
      password,
    },
  });
  const initialSignupRes = createResponse();
  await handler(initialSignupReq, initialSignupRes);
  assert.equal(initialSignupRes.statusCode, 200);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const duplicateSignupReq = createRequest({
      method: "POST",
      headers: authHeaders({
        "x-forwarded-for": challengeIp,
      }),
      body: {
        action: "signup",
        email: existingEmail,
        password,
      },
    });
    const duplicateSignupRes = createResponse();
    await handler(duplicateSignupReq, duplicateSignupRes);
    assert.equal(duplicateSignupRes.statusCode, 409);
  }

  const challengeReq = createRequest({
    method: "POST",
    headers: authHeaders({
      "x-forwarded-for": challengeIp,
    }),
    body: {
      action: "signup",
      email: existingEmail,
      password,
    },
  });
  const challengeRes = createResponse();
  await handler(challengeReq, challengeRes);
  assert.equal(challengeRes.statusCode, 428);
  assert.equal(challengeRes.body?.challengeRequired, true);
  const challengeToken = String(challengeRes.body?.challengeToken || "");
  const challengePrompt = String(challengeRes.body?.challengePrompt || "");
  const challengeAnswer = solveChallengePrompt(challengePrompt);
  assert.ok(challengeToken.length > 20);
  assert.ok(challengeAnswer.length > 0);

  const solvedSignupReq = createRequest({
    method: "POST",
    headers: authHeaders({
      "x-forwarded-for": challengeIp,
    }),
    body: {
      action: "signup",
      email: gatedEmail,
      password,
      challengeToken,
      challengeAnswer,
    },
  });
  const solvedSignupRes = createResponse();
  await handler(solvedSignupReq, solvedSignupRes);
  assert.equal(solvedSignupRes.statusCode, 200);
  assert.equal(solvedSignupRes.body?.ok, true);
  assert.equal(solvedSignupRes.body?.user?.email, gatedEmail.toLowerCase());
});

test("account auth delete-account removes account and clears session", async () => {
  const handler = await loadHandler();
  const email = `delete_me_${Date.now()}@example.com`;
  const password = "Strong-pass-123";

  const signupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password,
    },
  });
  const signupRes = createResponse();
  await handler(signupReq, signupRes);
  assert.equal(signupRes.statusCode, 200);
  const cookie = String(signupRes.headers["set-cookie"] || "");
  assert.match(cookie, /bills_account_session=/i);

  const invalidDeleteReq = createRequest({
    method: "POST",
    headers: authHeaders({ cookie }),
    body: {
      action: "delete-account",
      password: "Wrong-pass-123",
    },
  });
  const invalidDeleteRes = createResponse();
  await handler(invalidDeleteReq, invalidDeleteRes);
  assert.equal(invalidDeleteRes.statusCode, 401);
  assert.equal(invalidDeleteRes.body?.error, "Invalid email or password.");

  const beforeDeleteSessionReq = createRequest({
    method: "GET",
    headers: {
      host: "app.local",
      cookie,
    },
  });
  const beforeDeleteSessionRes = createResponse();
  await handler(beforeDeleteSessionReq, beforeDeleteSessionRes);
  assert.equal(beforeDeleteSessionRes.statusCode, 200);
  assert.equal(beforeDeleteSessionRes.body?.user?.email, email.toLowerCase());

  const deleteReq = createRequest({
    method: "POST",
    headers: authHeaders({ cookie }),
    body: {
      action: "delete-account",
      password,
    },
  });
  const deleteRes = createResponse();
  await handler(deleteReq, deleteRes);
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.body?.ok, true);
  assert.equal(deleteRes.body?.user, null);
  assert.match(String(deleteRes.headers["set-cookie"] || ""), /Max-Age=0/i);

  const afterDeleteSessionReq = createRequest({
    method: "GET",
    headers: {
      host: "app.local",
      cookie,
    },
  });
  const afterDeleteSessionRes = createResponse();
  await handler(afterDeleteSessionReq, afterDeleteSessionRes);
  assert.equal(afterDeleteSessionRes.statusCode, 200);
  assert.equal(afterDeleteSessionRes.body?.user, null);

  const loginReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "login",
      email,
      password,
    },
  });
  const loginRes = createResponse();
  await handler(loginReq, loginRes);
  assert.equal(loginRes.statusCode, 401);
  assert.equal(loginRes.body?.error, "Invalid email or password.");

  const reSignupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password,
    },
  });
  const reSignupRes = createResponse();
  await handler(reSignupReq, reSignupRes);
  assert.equal(reSignupRes.statusCode, 200);
  assert.equal(reSignupRes.body?.ok, true);
});

test("account auth change-password requires authenticated session", async () => {
  const handler = await loadHandler();

  const changeReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "change-password",
      currentPassword: "Strong-pass-123",
      newPassword: "Updated-pass-456",
    },
  });
  const changeRes = createResponse();
  await handler(changeReq, changeRes);
  assert.equal(changeRes.statusCode, 401);
  assert.equal(changeRes.body?.error, "Unauthorized.");
});

test("account auth change-password rejects invalid current password", async () => {
  const handler = await loadHandler();
  const email = `change_pw_wrong_${Date.now()}@example.com`;
  const password = "Strong-pass-123";

  const signupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password,
    },
  });
  const signupRes = createResponse();
  await handler(signupReq, signupRes);
  assert.equal(signupRes.statusCode, 200);
  const cookie = String(signupRes.headers["set-cookie"] || "");
  assert.match(cookie, /bills_account_session=/i);

  const changeReq = createRequest({
    method: "POST",
    headers: authHeaders({ cookie }),
    body: {
      action: "change-password",
      currentPassword: "Wrong-pass-123",
      newPassword: "Updated-pass-456",
    },
  });
  const changeRes = createResponse();
  await handler(changeReq, changeRes);
  assert.equal(changeRes.statusCode, 401);
  assert.equal(changeRes.body?.error, "Invalid email or password.");
});

test("account auth change-password updates credentials and invalidates prior session", async () => {
  const handler = await loadHandler();
  const email = `change_pw_${Date.now()}@example.com`;
  const oldPassword = "Strong-pass-123";
  const newPassword = "Updated-pass-456";

  const signupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password: oldPassword,
    },
  });
  const signupRes = createResponse();
  await handler(signupReq, signupRes);
  assert.equal(signupRes.statusCode, 200);
  const oldCookie = String(signupRes.headers["set-cookie"] || "");
  assert.match(oldCookie, /bills_account_session=/i);

  const changeReq = createRequest({
    method: "POST",
    headers: authHeaders({ cookie: oldCookie }),
    body: {
      action: "change-password",
      currentPassword: oldPassword,
      newPassword,
    },
  });
  const changeRes = createResponse();
  await handler(changeReq, changeRes);
  assert.equal(changeRes.statusCode, 200);
  assert.equal(changeRes.body?.ok, true);
  const newCookie = String(changeRes.headers["set-cookie"] || "");
  assert.match(newCookie, /bills_account_session=/i);

  const oldSessionReq = createRequest({
    method: "GET",
    headers: {
      host: "app.local",
      cookie: oldCookie,
    },
  });
  const oldSessionRes = createResponse();
  await handler(oldSessionReq, oldSessionRes);
  assert.equal(oldSessionRes.statusCode, 200);
  assert.equal(oldSessionRes.body?.user, null);

  const newSessionReq = createRequest({
    method: "GET",
    headers: {
      host: "app.local",
      cookie: newCookie,
    },
  });
  const newSessionRes = createResponse();
  await handler(newSessionReq, newSessionRes);
  assert.equal(newSessionRes.statusCode, 200);
  assert.equal(newSessionRes.body?.user?.email, email.toLowerCase());

  const oldLoginReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "login",
      email,
      password: oldPassword,
    },
  });
  const oldLoginRes = createResponse();
  await handler(oldLoginReq, oldLoginRes);
  assert.equal(oldLoginRes.statusCode, 401);
  assert.equal(oldLoginRes.body?.error, "Invalid email or password.");

  const newLoginReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "login",
      email,
      password: newPassword,
    },
  });
  const newLoginRes = createResponse();
  await handler(newLoginReq, newLoginRes);
  assert.equal(newLoginRes.statusCode, 200);
  assert.equal(newLoginRes.body?.ok, true);
});

test("account auth invalidates prior session after recovery password reset", async () => {
  const handler = await loadHandler();
  const email = `session_version_${Date.now()}@example.com`;
  const oldPassword = "Strong-pass-123";
  const newPassword = "Recover-pass-456";

  const signupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "signup",
      email,
      password: oldPassword,
    },
  });
  const signupRes = createResponse();
  await handler(signupReq, signupRes);
  assert.equal(signupRes.statusCode, 200);
  const oldCookie = String(signupRes.headers["set-cookie"] || "");
  assert.match(oldCookie, /bills_account_session=/i);
  const recoveryCode = String(signupRes.body?.recoveryCode || "");
  assert.match(recoveryCode, /^\d{4}-\d{4}-\d{4}$/);

  const recoverReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "complete-password-reset-recovery",
      email,
      recoveryCode,
      password: newPassword,
    },
  });
  const recoverRes = createResponse();
  await handler(recoverReq, recoverRes);
  assert.equal(recoverRes.statusCode, 200);
  const newCookie = String(recoverRes.headers["set-cookie"] || "");
  assert.match(newCookie, /bills_account_session=/i);

  const oldSessionReq = createRequest({
    method: "GET",
    headers: {
      host: "app.local",
      cookie: oldCookie,
    },
  });
  const oldSessionRes = createResponse();
  await handler(oldSessionReq, oldSessionRes);
  assert.equal(oldSessionRes.statusCode, 200);
  assert.equal(oldSessionRes.body?.user, null);

  const newSessionReq = createRequest({
    method: "GET",
    headers: {
      host: "app.local",
      cookie: newCookie,
    },
  });
  const newSessionRes = createResponse();
  await handler(newSessionReq, newSessionRes);
  assert.equal(newSessionRes.statusCode, 200);
  assert.equal(newSessionRes.body?.user?.email, email.toLowerCase());
});

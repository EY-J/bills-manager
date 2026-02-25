import test from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_DEBUG_TOKENS = "1";

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

test("account auth signup -> session -> logout flow", async () => {
  const handler = await loadHandler();
  const email = `user_${Date.now()}@example.com`;
  const password = "Strong-pass-123";

  const requestCodeReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "request-signup-code",
      email,
    },
  });
  const requestCodeRes = createResponse();
  await handler(requestCodeReq, requestCodeRes);
  assert.equal(requestCodeRes.statusCode, 200);
  assert.equal(requestCodeRes.body?.ok, true);
  assert.equal(typeof requestCodeRes.body?.debugCode, "string");
  assert.equal(String(requestCodeRes.body?.debugCode || "").length, 6);

  const completeReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "complete-signup",
      email,
      password,
      code: requestCodeRes.body?.debugCode,
    },
  });
  const completeRes = createResponse();
  await handler(completeReq, completeRes);
  assert.equal(completeRes.statusCode, 200);
  assert.equal(completeRes.body?.ok, true);
  assert.equal(completeRes.body?.user?.email, email.toLowerCase());
  const cookie = String(completeRes.headers["set-cookie"] || "");
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

test("account auth suppresses debug artifacts when explicit flag is disabled", async () => {
  const previous = process.env.AUTH_DEBUG_TOKENS;
  process.env.AUTH_DEBUG_TOKENS = "0";
  try {
    const handler = await loadHandler();
    const email = `no_debug_${Date.now()}@example.com`;

    const requestCodeReq = createRequest({
      method: "POST",
      headers: authHeaders(),
      body: {
        action: "request-signup-code",
        email,
      },
    });
    const requestCodeRes = createResponse();
    await handler(requestCodeReq, requestCodeRes);
    assert.equal(requestCodeRes.statusCode, 200);
    assert.equal("debugCode" in (requestCodeRes.body || {}), false);

    const requestResetReq = createRequest({
      method: "POST",
      headers: authHeaders(),
      body: {
        action: "request-password-reset-link",
        email,
      },
    });
    const requestResetRes = createResponse();
    await handler(requestResetReq, requestResetRes);
    assert.equal(requestResetRes.statusCode, 200);
    assert.equal("debugResetLink" in (requestResetRes.body || {}), false);
  } finally {
    process.env.AUTH_DEBUG_TOKENS = previous;
  }
});

test("account auth rejects invalid login", async () => {
  const handler = await loadHandler();
  const email = `user_${Date.now()}@example.com`;
  const password = "Strong-pass-123";

  const requestCodeReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "request-signup-code",
      email,
    },
  });
  const requestCodeRes = createResponse();
  await handler(requestCodeReq, requestCodeRes);
  assert.equal(requestCodeRes.statusCode, 200);

  const completeReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "complete-signup",
      email,
      password,
      code: requestCodeRes.body?.debugCode,
    },
  });
  const completeRes = createResponse();
  await handler(completeReq, completeRes);
  assert.equal(completeRes.statusCode, 200);

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

test("account auth rejects invalid verification code", async () => {
  const handler = await loadHandler();
  const email = `verify_${Date.now()}@example.com`;

  const requestCodeReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "request-signup-code",
      email,
    },
  });
  const requestCodeRes = createResponse();
  await handler(requestCodeReq, requestCodeRes);
  assert.equal(requestCodeRes.statusCode, 200);

  const completeReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "complete-signup",
      email,
      password: "Strong-pass-123",
      code: "000000",
    },
  });
  const completeRes = createResponse();
  await handler(completeReq, completeRes);
  assert.equal(completeRes.statusCode, 401);
  assert.equal(completeRes.body?.ok, false);
});

test("account auth password reset updates login credentials", async () => {
  const handler = await loadHandler();
  const email = `reset_${Date.now()}@example.com`;
  const oldPassword = "Strong-pass-123";
  const newPassword = "New-strong-pass-456";

  const requestSignupCodeReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "request-signup-code",
      email,
    },
  });
  const requestSignupCodeRes = createResponse();
  await handler(requestSignupCodeReq, requestSignupCodeRes);
  assert.equal(requestSignupCodeRes.statusCode, 200);

  const completeSignupReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "complete-signup",
      email,
      password: oldPassword,
      code: requestSignupCodeRes.body?.debugCode,
    },
  });
  const completeSignupRes = createResponse();
  await handler(completeSignupReq, completeSignupRes);
  assert.equal(completeSignupRes.statusCode, 200);

  const requestResetCodeReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "request-password-reset-link",
      email,
    },
  });
  const requestResetCodeRes = createResponse();
  await handler(requestResetCodeReq, requestResetCodeRes);
  assert.equal(requestResetCodeRes.statusCode, 200);
  assert.equal(requestResetCodeRes.body?.ok, true);
  assert.equal(typeof requestResetCodeRes.body?.debugResetLink, "string");
  const resetLink = String(requestResetCodeRes.body?.debugResetLink || "");
  const resetToken = new URL(resetLink).searchParams.get("resetToken");
  assert.equal(typeof resetToken, "string");
  assert.ok(String(resetToken || "").length > 20);

  const completeResetReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: {
      action: "complete-password-reset",
      token: resetToken,
      password: newPassword,
    },
  });
  const completeResetRes = createResponse();
  await handler(completeResetReq, completeResetRes);
  assert.equal(completeResetRes.statusCode, 200);
  assert.equal(completeResetRes.body?.ok, true);
  assert.equal(completeResetRes.body?.user?.email, email.toLowerCase());

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
  assert.equal(oldLoginRes.body?.ok, false);

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
  assert.equal(newLoginRes.body?.user?.email, email.toLowerCase());
});

test("account auth login throttles repeated failed attempts per email", async () => {
  const handler = await loadHandler();
  const email = `throttle_${Date.now()}@example.com`;
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

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const loginReq = createRequest({
      method: "POST",
      headers: authHeaders(),
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

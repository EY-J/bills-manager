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

async function loadAuthHandler() {
  const cacheBuster = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const mod = await import(`../api/account-auth.js?cache=${cacheBuster}`);
  return mod.default;
}

async function loadSyncHandler() {
  const cacheBuster = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const mod = await import(`../api/account-sync.js?cache=${cacheBuster}`);
  return mod.default;
}

function authHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    host: "app.local",
    ...extra,
  };
}

function samplePayload() {
  return {
    app: "bills-manager",
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    checksum: "abc12345",
    data: {
      notifyEnabled: false,
      bills: [
        {
          id: "bill_test_1",
          name: "Test bill",
          category: "Utilities",
          dueDate: "2026-02-25",
          amount: 1200,
          notes: "",
          payments: [],
        },
      ],
    },
  };
}

test("account sync stores and returns payload for authenticated user", async () => {
  const authHandler = await loadAuthHandler();
  const syncHandler = await loadSyncHandler();

  const email = `sync_${Date.now()}@example.com`;
  const password = "Strong-pass-123";

  const requestCodeReq = createRequest({
    method: "POST",
    headers: authHeaders(),
    body: { action: "request-signup-code", email },
  });
  const requestCodeRes = createResponse();
  await authHandler(requestCodeReq, requestCodeRes);
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
  await authHandler(completeReq, completeRes);
  assert.equal(completeRes.statusCode, 200);
  const cookie = String(completeRes.headers["set-cookie"] || "");
  assert.match(cookie, /bills_account_session=/i);

  const putReq = createRequest({
    method: "PUT",
    headers: authHeaders({ cookie }),
    body: { payload: samplePayload() },
  });
  const putRes = createResponse();
  await syncHandler(putReq, putRes);
  assert.equal(putRes.statusCode, 200);
  assert.equal(putRes.body?.ok, true);
  assert.equal(typeof putRes.body?.updatedAt, "string");

  const getReq = createRequest({
    method: "GET",
    headers: { host: "app.local", cookie },
  });
  const getRes = createResponse();
  await syncHandler(getReq, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body?.ok, true);
  assert.equal(getRes.body?.payload?.app, "bills-manager");
  assert.equal(Array.isArray(getRes.body?.payload?.data?.bills), true);
});

test("account sync rejects unauthenticated access", async () => {
  const syncHandler = await loadSyncHandler();
  const req = createRequest({
    method: "GET",
    headers: { host: "app.local" },
  });
  const res = createResponse();
  await syncHandler(req, res);
  assert.equal(res.statusCode, 401);
});

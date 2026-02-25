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
      this.headers[String(key).toLowerCase()] = String(value);
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
  const mod = await import(`../api/runtime-errors.js?cache=${cacheBuster}`);
  return mod.default;
}

function validPayload() {
  return {
    timestamp: new Date().toISOString(),
    message: "Runtime crash sample",
    name: "Error",
    context: { source: "test" },
  };
}

test("runtime error API rejects non-POST methods", async () => {
  const handler = await loadHandler();
  const req = createRequest({ method: "GET" });
  const res = createResponse();

  handler(req, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "POST");
  assert.equal(res.headers["cache-control"], "no-store, max-age=0");
  assert.equal(res.headers.pragma, "no-cache");
});

test("runtime error API rejects cross-origin requests", async () => {
  const handler = await loadHandler();
  const req = createRequest({
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example",
      host: "app.local",
    },
    body: validPayload(),
  });
  const res = createResponse();

  handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.match(res.body?.error || "", /cross-origin/i);
});

test("runtime error API rejects cross-site fetches without origin", async () => {
  const handler = await loadHandler();
  const req = createRequest({
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "cross-site",
      host: "app.local",
    },
    body: validPayload(),
  });
  const res = createResponse();

  handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.match(res.body?.error || "", /cross-site/i);
});

test("runtime error API allows same-origin fetch-site", async () => {
  const handler = await loadHandler();
  const req = createRequest({
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      host: "app.local",
    },
    body: validPayload(),
  });
  const res = createResponse();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    handler(req, res);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 204);
});

test("runtime error API enforces JSON content type", async () => {
  const handler = await loadHandler();
  const req = createRequest({
    method: "POST",
    headers: {
      "content-type": "text/plain",
      host: "app.local",
    },
    body: "oops",
  });
  const res = createResponse();

  handler(req, res);

  assert.equal(res.statusCode, 415);
});

test("runtime error API enforces payload size limit", async () => {
  const handler = await loadHandler();
  const req = createRequest({
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(16 * 1024 + 1),
      host: "app.local",
    },
    body: validPayload(),
  });
  const res = createResponse();

  handler(req, res);

  assert.equal(res.statusCode, 413);
});

test("runtime error API enforces payload size when content-length is missing", async () => {
  const handler = await loadHandler();
  const req = createRequest({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.local",
    },
    body: {
      ...validPayload(),
      message: "x".repeat(17 * 1024),
    },
  });
  const res = createResponse();

  handler(req, res);

  assert.equal(res.statusCode, 413);
});

test("runtime error API enforces payload shape", async () => {
  const handler = await loadHandler();
  const req = createRequest({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.local",
    },
    body: {
      // Missing `message`
      timestamp: new Date().toISOString(),
    },
  });
  const res = createResponse();

  handler(req, res);

  assert.equal(res.statusCode, 422);
});

test("runtime error API rejects stale timestamps", async () => {
  const handler = await loadHandler();
  const req = createRequest({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.local",
    },
    body: {
      ...validPayload(),
      timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  const res = createResponse();

  handler(req, res);

  assert.equal(res.statusCode, 422);
  assert.match(res.body?.error || "", /timestamp/i);
});

test("runtime error API rejects far-future timestamps", async () => {
  const handler = await loadHandler();
  const req = createRequest({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.local",
    },
    body: {
      ...validPayload(),
      timestamp: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
  });
  const res = createResponse();

  handler(req, res);

  assert.equal(res.statusCode, 422);
  assert.match(res.body?.error || "", /timestamp/i);
});

test("runtime error API accepts valid payloads", async () => {
  const handler = await loadHandler();
  const req = createRequest({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.local",
    },
    body: validPayload(),
  });
  const res = createResponse();

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    handler(req, res);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.equal(res.headers["cache-control"], "no-store, max-age=0");
  assert.equal(res.headers.pragma, "no-cache");
});

test("runtime error API rate limits noisy clients", async () => {
  const handler = await loadHandler();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    let lastResponse = null;
    for (let i = 0; i < 31; i += 1) {
      const req = createRequest({
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "app.local",
        },
        body: validPayload(),
        remoteAddress: "10.0.0.8",
      });
      const res = createResponse();
      handler(req, res);
      lastResponse = res;
    }

    assert.equal(lastResponse.statusCode, 429);
    assert.equal(lastResponse.headers["retry-after"], "60");
  } finally {
    console.error = originalConsoleError;
  }
});

test("runtime error API evicts oldest buckets when IP map reaches max capacity", async () => {
  const handler = await loadHandler();
  const headers = {
    "content-type": "application/json",
    host: "app.local",
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    for (let i = 0; i < 30; i += 1) {
      const req = createRequest({
        method: "POST",
        headers,
        body: validPayload(),
        remoteAddress: "10.0.0.1",
      });
      const res = createResponse();
      handler(req, res);
      assert.equal(res.statusCode, 204);
    }

    for (let i = 0; i < 1100; i += 1) {
      const req = createRequest({
        method: "POST",
        headers,
        body: validPayload(),
        remoteAddress: `10.0.1.${i}`,
      });
      const res = createResponse();
      handler(req, res);
      assert.equal(res.statusCode, 204);
    }

    const req = createRequest({
      method: "POST",
      headers,
      body: validPayload(),
      remoteAddress: "10.0.0.1",
    });
    const res = createResponse();
    handler(req, res);

    assert.equal(res.statusCode, 204);
  } finally {
    console.error = originalConsoleError;
  }
});

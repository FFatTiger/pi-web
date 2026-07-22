import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const request = await jiti.import("./push-request.ts");

function post(body, headers = {}, url = "https://pi.example/api/push/test") {
  return new Request(url, {
    method: "POST",
    headers: {
      origin: "https://pi.example",
      "content-type": "application/json",
      "x-pi-web-auth-status": "enabled",
      ...headers,
    },
    body,
  });
}

async function assertError(result, status, code) {
  assert.ok(result instanceof Response, `expected Response, got ${typeof result}`);
  assert.equal(result.status, status);
  const body = await result.json();
  assert.equal(body.code, code);
  assert.equal(typeof body.error, "string");
  // Safe public errors must not leak secrets, config diagnostics, or parser internals.
  assert.doesNotMatch(JSON.stringify(body), /secret|logMessage|privateKey|parser text|Unexpected token|SyntaxError|bad secret path/i);
  assert.equal(Object.keys(body).sort().join(","), "code,error");
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.match(result.headers.get("content-type") || "", /^application\/json\b/i);
}

test("reads same-origin bounded JSON and returns no-store responses", async () => {
  assert.deepEqual(await request.readPushJsonBody(post('{"ok":true}')), { ok: true });
  const response = request.pushJson({ ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type") || "", /^application\/json\b/i);
  assert.deepEqual(await response.json(), { ok: true });
});

test("rejects origin, media type, malformed JSON, and bodies over 16 KiB", async () => {
  const cases = [
    [post("{}", { origin: "https://evil.example" }), 403, "PUSH_ORIGIN_MISMATCH"],
    [post("{}", { "content-type": "text/plain" }), 415, "PUSH_JSON_REQUIRED"],
    [post("{broken"), 400, "PUSH_INVALID_BODY"],
    [post(JSON.stringify({ value: "x".repeat(17 * 1024) })), 413, "PUSH_BODY_TOO_LARGE"],
  ];
  for (const [input, status, code] of cases) {
    await assertError(await request.readPushJsonBody(input), status, code);
  }
});

test("requires both enabled gate config and the proxy-authenticated header", async () => {
  const enabled = { status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" };
  assert.deepEqual(request.requireEnabledPushRequest(post("{}"), enabled), { password: "secret" });

  const disabled = request.requireEnabledPushRequest(post("{}"), {
    status: "disabled",
    configPath: "/tmp/pi-web.json",
  });
  await assertError(disabled, 403, "PUSH_GATE_REQUIRED");

  const unconfigured = request.requireEnabledPushRequest(post("{}"), {
    status: "unconfigured",
    configPath: "/tmp/pi-web.json",
  });
  await assertError(unconfigured, 503, "PUSH_AUTH_CONFIG_ERROR");

  const errored = request.requireEnabledPushRequest(post("{}"), {
    status: "error",
    configPath: "/tmp/pi-web.json",
    logMessage: "bad secret path details",
  });
  await assertError(errored, 503, "PUSH_AUTH_CONFIG_ERROR");

  const unauthorized = request.requireEnabledPushRequest(
    post("{}", { "x-pi-web-auth-status": "disabled" }),
    enabled,
  );
  await assertError(unauthorized, 401, "PUSH_UNAUTHORIZED");

  const missingHeader = request.requireEnabledPushRequest(
    post("{}", { "x-pi-web-auth-status": "" }),
    enabled,
  );
  // empty header is not exactly "enabled"
  await assertError(
    request.requireEnabledPushRequest(
      new Request("https://pi.example/api/push/test", {
        method: "POST",
        headers: { origin: "https://pi.example", "content-type": "application/json" },
        body: "{}",
      }),
      enabled,
    ),
    401,
    "PUSH_UNAUTHORIZED",
  );
  await assertError(missingHeader, 401, "PUSH_UNAUTHORIZED");
});

test("origin check is exact against request URL origin including ports and absent values", async () => {
  const cases = [
    [post("{}", { origin: "null" }), 403, "PUSH_ORIGIN_MISMATCH"],
    [
      new Request("https://pi.example/api/push/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      403,
      "PUSH_ORIGIN_MISMATCH",
    ],
    [post("{}", { origin: "https://PI.EXAMPLE" }), 403, "PUSH_ORIGIN_MISMATCH"],
    [post("{}", { origin: "https://pi.example:443" }), 403, "PUSH_ORIGIN_MISMATCH"],
    [post("{}", { origin: "http://pi.example" }), 403, "PUSH_ORIGIN_MISMATCH"],
    [post("{}", { origin: "https://pi.example:8443" }), 403, "PUSH_ORIGIN_MISMATCH"],
    [
      post("{}", { origin: "https://pi.example:8443" }, "https://pi.example:8443/api/push/test"),
      // same non-default port should succeed later; just ensure no origin error path
    ],
  ];

  for (const entry of cases) {
    if (entry.length === 3) {
      const [input, status, code] = entry;
      await assertError(await request.readPushJsonBody(input), status, code);
    }
  }

  const samePort = await request.readPushJsonBody(
    post("{}", { origin: "https://pi.example:8443" }, "https://pi.example:8443/api/push/test"),
  );
  assert.deepEqual(samePort, {});

  // default HTTPS port is stripped from URL.origin
  const defaultPortRequest = await request.readPushJsonBody(
    post("{}", { origin: "https://pi.example" }, "https://pi.example:443/api/push/test"),
  );
  assert.deepEqual(defaultPortRequest, {});
});

test("content-type allows parameters and is case-insensitive before semicolon", async () => {
  assert.deepEqual(
    await request.readPushJsonBody(post("{}", { "content-type": "Application/JSON" })),
    {},
  );
  assert.deepEqual(
    await request.readPushJsonBody(
      post("{}", { "content-type": "application/json; charset=utf-8" }),
    ),
    {},
  );
  assert.deepEqual(
    await request.readPushJsonBody(
      post("{}", { "content-type": "application/json ; charset=utf-8" }),
    ),
    {},
  );
  await assertError(
    await request.readPushJsonBody(post("{}", { "content-type": "application/jsonn" })),
    415,
    "PUSH_JSON_REQUIRED",
  );
  await assertError(
    await request.readPushJsonBody(post("{}", { "content-type": "application/*" })),
    415,
    "PUSH_JSON_REQUIRED",
  );
  await assertError(
    await request.readPushJsonBody(
      new Request("https://pi.example/api/push/test", {
        method: "POST",
        headers: { origin: "https://pi.example" },
        body: "{}",
      }),
    ),
    415,
    "PUSH_JSON_REQUIRED",
  );
});

test("enforces 16 KiB by Content-Length and actual body bytes including multibyte", async () => {
  const limit = request.PUSH_BODY_LIMIT_BYTES;
  assert.equal(limit, 16 * 1024);

  // exact limit ASCII JSON string payload: quotes + 16382 chars = 16384 bytes
  const exactValue = "x".repeat(limit - 2);
  const exactBody = `"${exactValue}"`;
  assert.equal(Buffer.byteLength(exactBody, "utf8"), limit);
  assert.equal(await request.readPushJsonBody(post(exactBody)), exactValue);

  // Content-Length over limit fails closed before body read
  await assertError(
    await request.readPushJsonBody(
      post("{}", { "content-length": String(limit + 1) }),
    ),
    413,
    "PUSH_BODY_TOO_LARGE",
  );

  // invalid Content-Length fails closed
  for (const contentLength of ["", "12.5", "-1", "1e3", "abc", "16384,16384"]) {
    await assertError(
      await request.readPushJsonBody(post("{}", { "content-length": contentLength })),
      413,
      "PUSH_BODY_TOO_LARGE",
    );
  }

  // multibyte: 3-byte UTF-8 chars — byte count over limit even if char count looks small
  const threeByte = "\u4e2d"; // 中
  const overMultibyte = threeByte.repeat(Math.floor(limit / 3) + 1);
  const overMultibyteBody = JSON.stringify(overMultibyte);
  assert.ok(Buffer.byteLength(overMultibyteBody, "utf8") > limit);
  await assertError(
    await request.readPushJsonBody(post(overMultibyteBody)),
    413,
    "PUSH_BODY_TOO_LARGE",
  );

  // oversize body rejects by actual bytes (Fetch may also set Content-Length)
  const oversizeBody = `"${"y".repeat(limit - 1)}"`; // quotes + limit-1 = limit+1 bytes
  assert.equal(Buffer.byteLength(oversizeBody, "utf8"), limit + 1);
  await assertError(await request.readPushJsonBody(post(oversizeBody)), 413, "PUSH_BODY_TOO_LARGE");
});

test("rejects invalid UTF-8 and accepts valid JSON values as unknown", async () => {
  const invalidUtf8 = new Uint8Array([0x7b, 0xff, 0x7d]); // { <invalid> }
  const req = new Request("https://pi.example/api/push/test", {
    method: "POST",
    headers: {
      origin: "https://pi.example",
      "content-type": "application/json",
    },
    body: invalidUtf8,
  });
  await assertError(await request.readPushJsonBody(req), 400, "PUSH_INVALID_BODY");

  // valid JSON values are returned as unknown; callers validate shape later
  assert.equal(await request.readPushJsonBody(post("null")), null);
  assert.deepEqual(await request.readPushJsonBody(post("[1]")), [1]);
  assert.equal(await request.readPushJsonBody(post("1")), 1);
});

test("pushError/pushJson/isResponse helpers are safe and no-store", async () => {
  assert.equal(request.isResponse(new Response("x")), true);
  assert.equal(request.isResponse({ status: 200 }), false);
  assert.equal(request.isResponse(null), false);

  const err = request.pushError(400, "PUSH_INVALID_BODY", "Push request body is invalid");
  await assertError(err, 400, "PUSH_INVALID_BODY");

  const custom = request.pushJson({ ok: true }, { status: 201 });
  assert.equal(custom.status, 201);
  assert.equal(custom.headers.get("cache-control"), "no-store");
  assert.deepEqual(await custom.json(), { ok: true });
});

function makeTrackedStream(chunkSize, maxPulls, options = {}) {
  const { failAfterPulls, fillByte = 0x61 } = options;
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (typeof failAfterPulls === "number" && pulls > failAfterPulls) {
        controller.error(new Error("stream boom: secret path details"));
        return;
      }
      if (pulls > maxPulls) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunkSize).fill(fillByte));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    stream,
    stats: () => ({ pulls, cancelled }),
  };
}

function streamRequest(stream, headers = {}) {
  return new Request("https://pi.example/api/push/test", {
    method: "POST",
    headers: {
      origin: "https://pi.example",
      "content-type": "application/json",
      ...headers,
    },
    body: stream,
    duplex: "half",
  });
}

test("no-content-length oversize stream cancels early and stays bounded", async () => {
  const chunkSize = 4096;
  const { stream, stats } = makeTrackedStream(chunkSize, 20);
  const result = await request.readPushJsonBody(streamRequest(stream));
  await assertError(result, 413, "PUSH_BODY_TOO_LARGE");
  const { pulls, cancelled } = stats();
  assert.equal(cancelled, true);
  // 16 KiB / 4096 = 4 accepted chunks; 5th exceeds. Allow at most one unavoidable prefetch.
  assert.ok(pulls >= 5 && pulls <= 6, `expected 5-6 pulls, got ${pulls}`);
});

test("exact-limit streamed JSON succeeds without cancel", async () => {
  const limit = request.PUSH_BODY_LIMIT_BYTES;
  const exactValue = "x".repeat(limit - 2);
  const exactBody = `"${exactValue}"`;
  assert.equal(Buffer.byteLength(exactBody, "utf8"), limit);

  const encoder = new TextEncoder();
  const bytes = encoder.encode(exactBody);
  let offset = 0;
  let pulls = 0;
  let cancelled = false;
  const chunkSize = 4096;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
    cancel() {
      cancelled = true;
    },
  });

  const result = await request.readPushJsonBody(streamRequest(stream));
  assert.equal(result, exactValue);
  assert.equal(cancelled, false);
  assert.ok(pulls >= 4 && pulls <= 6, `expected few pulls for exact body, got ${pulls}`);
});

test("content-length overlimit does not drain the request body stream", async () => {
  const { stream, stats } = makeTrackedStream(4096, 20);
  const req = streamRequest(stream, {
    "content-length": String(request.PUSH_BODY_LIMIT_BYTES + 1),
  });
  // Undici/Request may schedule one autonomous prefetch microtask before our helper runs.
  await Promise.resolve();
  await Promise.resolve();
  const pullsAfterConstruct = stats().pulls;
  const result = await request.readPushJsonBody(req);
  await assertError(result, 413, "PUSH_BODY_TOO_LARGE");
  const after = stats();
  // Helper must not continue reading. At most one runtime-queued pull is allowed; never drain.
  assert.ok(
    after.pulls <= Math.max(pullsAfterConstruct, 1),
    `expected at most one runtime pull after CL reject, got ${after.pulls} (construct=${pullsAfterConstruct})`,
  );
  assert.ok(after.pulls < 5, `must not drain stream after CL reject, got ${after.pulls} pulls`);
});

test("stream read errors map to generic invalid body without leaking details", async () => {
  const { stream, stats } = makeTrackedStream(64, 10, { failAfterPulls: 1 });
  const result = await request.readPushJsonBody(streamRequest(stream));
  // assertError consumes the body once; do not clone afterward.
  await assertError(result, 400, "PUSH_INVALID_BODY");
  const { pulls } = stats();
  // After controller.error, source cancel may not run; require generic 400 + no hang only.
  assert.ok(pulls >= 1 && pulls <= 3, `expected few pulls before stream error, got ${pulls}`);
});

test("content-length underlimit still enforces actual stream byte bound", async () => {
  const chunkSize = 4096;
  const { stream, stats } = makeTrackedStream(chunkSize, 20);
  // Lie low: honest Content-Length would not reject, but actual stream exceeds 16 KiB.
  const result = await request.readPushJsonBody(
    streamRequest(stream, { "content-length": "100" }),
  );
  await assertError(result, 413, "PUSH_BODY_TOO_LARGE");
  const { pulls, cancelled } = stats();
  assert.equal(cancelled, true);
  assert.ok(pulls >= 5 && pulls <= 6, `expected 5-6 pulls when CL lies low, got ${pulls}`);
});

test("null or empty body is invalid JSON without hanging", async () => {
  const empty = new Request("https://pi.example/api/push/test", {
    method: "POST",
    headers: {
      origin: "https://pi.example",
      "content-type": "application/json",
    },
  });
  await assertError(await request.readPushJsonBody(empty), 400, "PUSH_INVALID_BODY");
});

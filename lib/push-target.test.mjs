import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const target = await jiti.import("./push-target.ts");
const p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
const auth = Buffer.alloc(16, 2).toString("base64url");

function validInput(overrides = {}) {
  return {
    endpoint: "https://push.example/v1/send/abc",
    keys: { p256dh, auth },
    ...overrides,
  };
}

test("accepts only exact HTTPS endpoint and decoded key shapes", () => {
  assert.deepEqual(target.validatePushSubscription({
    endpoint: "https://push.example/v1/send/abc", keys: { p256dh, auth },
  }), { endpoint: "https://push.example/v1/send/abc", p256dh, auth });
  for (const value of [
    { endpoint: "http://push.example/a", keys: { p256dh, auth } },
    { endpoint: "https://user:pass@push.example/a", keys: { p256dh, auth } },
    { endpoint: "https://127.0.0.1/a", keys: { p256dh, auth } },
    { endpoint: "https://localhost/a", keys: { p256dh, auth } },
    { endpoint: `https://${"a".repeat(4090)}.example/a`, keys: { p256dh, auth } },
    { endpoint: "https://push.example/a", keys: { p256dh: p256dh + "=", auth } },
    { endpoint: "https://push.example/a", keys: { p256dh: Buffer.alloc(65).toString("base64url"), auth } },
    { endpoint: "https://push.example/a", keys: { p256dh, auth: "short" } },
  ]) assert.throws(() => target.validatePushSubscription(value), (error) => error.code === "PUSH_INVALID_SUBSCRIPTION");
});

test("rejects non-exact shapes, credentials, localhost forms, and IP literals", () => {
  const rejects = [
    null,
    undefined,
    [],
    "https://push.example/a",
    { endpoint: "https://push.example/a" },
    { endpoint: "https://push.example/a", keys: { p256dh, auth }, extra: 1 },
    { endpoint: "https://push.example/a", keys: { p256dh, auth, extra: true } },
    { endpoint: "https://push.example/a", keys: { p256dh } },
    { endpoint: "ftp://push.example/a", keys: { p256dh, auth } },
    { endpoint: "https://user@push.example/a", keys: { p256dh, auth } },
    { endpoint: "https://:pass@push.example/a", keys: { p256dh, auth } },
    { endpoint: "https://localhost./a", keys: { p256dh, auth } },
    { endpoint: "https://foo.localhost/a", keys: { p256dh, auth } },
    { endpoint: "https://FOO.LOCALHOST/a", keys: { p256dh, auth } },
    { endpoint: "https://[::1]/a", keys: { p256dh, auth } },
    { endpoint: "https://[2001:db8::1]/a", keys: { p256dh, auth } },
    { endpoint: "https://8.8.8.8/a", keys: { p256dh, auth } },
    { endpoint: "https://push.example/a", keys: { p256dh: p256dh.slice(0, -1) + "+", auth } },
    { endpoint: "https://push.example/a", keys: { p256dh: p256dh.toLowerCase() === p256dh ? p256dh : p256dh, auth: auth + "=" } },
  ];
  for (const value of rejects) {
    assert.throws(
      () => target.validatePushSubscription(value),
      (error) => error && error.code === "PUSH_INVALID_SUBSCRIPTION",
      String(value && value.endpoint ? value.endpoint : value),
    );
  }

  // Exact length 4096 UTF-8 bytes is accepted when host is domain-only HTTPS.
  const host = "push.example";
  const base = `https://${host}/`;
  const padLen = 4096 - Buffer.byteLength(base, "utf8");
  const endpoint4096 = base + "x".repeat(padLen);
  assert.equal(Buffer.byteLength(endpoint4096, "utf8"), 4096);
  assert.deepEqual(target.validatePushSubscription(validInput({ endpoint: endpoint4096 })), {
    endpoint: endpoint4096,
    p256dh,
    auth,
  });

  // 4097 is rejected.
  assert.throws(
    () => target.validatePushSubscription(validInput({ endpoint: endpoint4096 + "y" })),
    (error) => error.code === "PUSH_INVALID_SUBSCRIPTION",
  );
});

test("classifies private, local, mapped, and public addresses", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1"]) {
    assert.equal(target.isPublicPushAddress(address, 4), false, address);
  }
  for (const address of ["::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
    assert.equal(target.isPublicPushAddress(address, 6), false, address);
  }
  assert.equal(target.isPublicPushAddress("8.8.8.8", 4), true);
  assert.equal(target.isPublicPushAddress("2606:4700:4700::1111", 6), true);
});

test("IPv4 public address policy range boundaries", () => {
  const deny = [
    "",
    "not-an-ip",
    "0.0.0.0",
    "0.255.255.255",
    "10.0.0.0",
    "10.255.255.255",
    "100.64.0.0",
    "100.127.255.255",
    "127.0.0.0",
    "127.255.255.255",
    "169.254.0.0",
    "169.254.255.255",
    "172.16.0.0",
    "172.31.255.255",
    "192.168.0.0",
    "192.168.255.255",
    "224.0.0.0",
    "239.255.255.255",
    "240.0.0.0",
    "255.255.255.255",
  ];
  for (const address of deny) {
    assert.equal(target.isPublicPushAddress(address, 4), false, `deny ${address}`);
  }

  const allow = [
    "1.1.1.1",
    "8.8.8.8",
    "9.255.255.255",
    "11.0.0.0",
    "100.63.255.255",
    "100.128.0.0",
    "126.255.255.255",
    "128.0.0.1",
    "169.253.255.255",
    "169.255.0.1",
    "172.15.255.255",
    "172.32.0.0",
    "192.167.255.255",
    "192.169.0.1",
    "223.255.255.255",
  ];
  for (const address of allow) {
    assert.equal(target.isPublicPushAddress(address, 4), true, `allow ${address}`);
  }

  // Wrong family is never public.
  assert.equal(target.isPublicPushAddress("8.8.8.8", 6), false);
  assert.equal(target.isPublicPushAddress("2606:4700:4700::1111", 4), false);
});

test("IPv6 public address policy range boundaries and mapped forms", () => {
  const deny = [
    "::",
    "::1",
    "fe80::",
    "fe80::1",
    "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fc00::",
    "fc00::1",
    "fd12:3456:789a::1",
    "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "ff00::",
    "ff02::1",
    "ffff::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:192.168.0.1",
    "::ffff:169.254.1.1",
    "::ffff:100.64.0.1",
    "::ffff:0.0.0.0",
    "::ffff:7f00:1", // hex form of 127.0.0.1
    "::ffff:a00:1", // hex form of 10.0.0.1
    "::ffff:c0a8:1", // 192.168.0.1
  ];
  for (const address of deny) {
    assert.equal(target.isPublicPushAddress(address, 6), false, `deny ${address}`);
  }

  const allow = [
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
    "2a00:1450:4001:829::200e",
    "::ffff:8.8.8.8",
    "::ffff:1.1.1.1",
    "::ffff:808:808", // hex form of 8.8.8.8
  ];
  for (const address of allow) {
    assert.equal(target.isPublicPushAddress(address, 6), true, `allow ${address}`);
  }
});

test("rejects expanded and alternate IPv4-mapped IPv6 private forms", () => {
  const deny = [
    // Fully expanded dotted/hex loopback and private (bypass if only ::ffff: prefix checked)
    "0:0:0:0:0:ffff:127.0.0.1",
    "0:0:0:0:0:ffff:7f00:1",
    "0:0:0:0:0:ffff:10.0.0.1",
    "0:0:0:0:0:ffff:a00:1",
    "0:0:0:0:0:ffff:192.168.0.1",
    "0:0:0:0:0:ffff:c0a8:1",
    "0000:0000:0000:0000:0000:ffff:127.0.0.1",
    "0000:0000:0000:0000:0000:ffff:0a00:0001",
    // Alternate compression that does not start with ::ffff:
    "0::ffff:127.0.0.1",
    "0::ffff:7f00:1",
    "0::ffff:10.0.0.1",
    "::0:ffff:10.0.0.1",
    "0:0::ffff:192.168.1.1",
    // Uppercase expanded / mixed case
    "0:0:0:0:0:FFFF:127.0.0.1",
    "0:0:0:0:0:FfFf:7F00:1",
    "0::FFFF:A00:1",
  ];
  for (const address of deny) {
    assert.equal(target.isPublicPushAddress(address, 6), false, `deny expanded mapped ${address}`);
  }

  const allow = [
    "0:0:0:0:0:ffff:8.8.8.8",
    "0:0:0:0:0:ffff:808:808",
    "0000:0000:0000:0000:0000:ffff:0808:0808",
    "0::ffff:1.1.1.1",
    "0:0:0:0:0:FFFF:8.8.8.8",
  ];
  for (const address of allow) {
    assert.equal(target.isPublicPushAddress(address, 6), true, `allow expanded mapped public ${address}`);
  }

  // Non-mapped policy still denies ULA / link-local after any normalization path.
  assert.equal(target.isPublicPushAddress("0:0:0:0:0:0:0:1", 6), false);
  assert.equal(target.isPublicPushAddress("fc00:0:0:0:0:0:0:1", 6), false);
  assert.equal(target.isPublicPushAddress("fe80:0:0:0:0:0:0:1", 6), false);
});

function callLookup(lookup, hostname, options = { all: false }) {
  return new Promise((resolve, reject) =>
    lookup(hostname, options, (error, address, family) =>
      error ? reject(error) : resolve(options.all ? address : { address, family }),
    ),
  );
}

test("actual-socket lookup rejects empty and mixed result sets", async () => {
  await assert.rejects(callLookup(target.createValidatedLookup(async () => []), "push.example"), /unsafe|resolve/i);
  await assert.rejects(callLookup(target.createValidatedLookup(async () => [
    { address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 },
  ]), "push.example"), /unsafe/i);
  assert.deepEqual(await callLookup(target.createValidatedLookup(async () => [
    { address: "2606:4700:4700::1111", family: 6 }, { address: "8.8.8.8", family: 4 },
  ]), "push.example"), { address: "2606:4700:4700::1111", family: 6 });
});

test("lookup rejects pure private, mapped private, and resolver failures without leaking detail", async () => {
  await assert.rejects(
    callLookup(target.createValidatedLookup(async () => [{ address: "10.0.0.1", family: 4 }]), "push.example"),
    (error) =>
      error.code === "PUSH_UNSAFE_ENDPOINT" &&
      !String(error.message).includes("10.0.0.1") &&
      !String(error.message).includes("push.example"),
  );

  await assert.rejects(
    callLookup(
      target.createValidatedLookup(async () => [{ address: "::ffff:127.0.0.1", family: 6 }]),
      "push.example",
    ),
    (error) => error.code === "PUSH_UNSAFE_ENDPOINT",
  );

  await assert.rejects(
    callLookup(
      target.createValidatedLookup(async () => {
        throw new Error("ENOTFOUND secret.internal.example detail 10.1.2.3");
      }),
      "push.example",
    ),
    (error) =>
      error.code === "PUSH_UNSAFE_ENDPOINT" &&
      !String(error.message).includes("secret.internal") &&
      !String(error.message).includes("10.1.2.3"),
  );
});

test("lookup honors family and all options after full-set validation", async () => {
  const resolveAll = async () => [
    { address: "2606:4700:4700::1111", family: 6 },
    { address: "8.8.8.8", family: 4 },
  ];
  const lookup = target.createValidatedLookup(resolveAll);

  assert.deepEqual(await callLookup(lookup, "push.example", { family: 4 }), {
    address: "8.8.8.8",
    family: 4,
  });
  assert.deepEqual(await callLookup(lookup, "push.example", { family: 6 }), {
    address: "2606:4700:4700::1111",
    family: 6,
  });
  assert.deepEqual(await callLookup(lookup, "push.example", { all: true }), [
    { address: "2606:4700:4700::1111", family: 6 },
    { address: "8.8.8.8", family: 4 },
  ]);
  assert.deepEqual(await callLookup(lookup, "push.example", { all: true, order: "ipv4first" }), [
    { address: "8.8.8.8", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ]);

  // Mixed private is rejected even when family would drop the private record.
  await assert.rejects(
    callLookup(
      target.createValidatedLookup(async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]),
      "push.example",
      { family: 4 },
    ),
    (error) => error.code === "PUSH_UNSAFE_ENDPOINT",
  );

  // Expanded mapped private mixed with public must reject before family filter.
  await assert.rejects(
    callLookup(
      target.createValidatedLookup(async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "0:0:0:0:0:ffff:7f00:1", family: 6 },
      ]),
      "push.example",
      { family: 4 },
    ),
    (error) => error.code === "PUSH_UNSAFE_ENDPOINT",
  );
});

test("lookup Node option overloads and callback-once semantics", async () => {
  const publicDual = async () => [
    { address: "2606:4700:4700::1111", family: 6 },
    { address: "8.8.8.8", family: 4 },
  ];
  const lookup = target.createValidatedLookup(publicDual);

  // Callback-only overload (no options argument).
  const noOpts = await new Promise((resolve, reject) => {
    lookup("push.example", (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(noOpts, { address: "2606:4700:4700::1111", family: 6 });

  // Numeric family overload (family = 4).
  const familyNum = await new Promise((resolve, reject) => {
    lookup("push.example", 4, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(familyNum, { address: "8.8.8.8", family: 4 });

  // family:6 with IPv4-only validated set fails closed after full-set validation.
  await assert.rejects(
    callLookup(
      target.createValidatedLookup(async () => [{ address: "8.8.8.8", family: 4 }]),
      "push.example",
      { family: 6 },
    ),
    (error) => error.code === "PUSH_UNSAFE_ENDPOINT",
  );

  // Resolver rejection: callback exactly once, generic unsafe code, no leak.
  let calls = 0;
  const failing = target.createValidatedLookup(async () => {
    throw new Error("ENOTFOUND leak.host 10.9.8.7");
  });
  await new Promise((resolve, reject) => {
    failing("push.example", { all: false }, (error) => {
      calls += 1;
      try {
        assert.equal(error.code, "PUSH_UNSAFE_ENDPOINT");
        assert.equal(String(error.message).includes("leak.host"), false);
        assert.equal(String(error.message).includes("10.9.8.7"), false);
        resolve(undefined);
      } catch (assertionError) {
        reject(assertionError);
      }
    });
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
});

test("trailing-dot public domains accepted; localhost trailing-dot rejected", () => {
  const p256 = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
  const a = Buffer.alloc(16, 2).toString("base64url");
  assert.deepEqual(
    target.validatePushSubscription({
      endpoint: "https://push.example./v1",
      keys: { p256dh: p256, auth: a },
    }),
    { endpoint: "https://push.example./v1", p256dh: p256, auth: a },
  );
  for (const endpoint of ["https://localhost./a", "https://foo.localhost./a"]) {
    assert.throws(
      () => target.validatePushSubscription({ endpoint, keys: { p256dh: p256, auth: a } }),
      (error) => error.code === "PUSH_INVALID_SUBSCRIPTION",
    );
  }
});

test("createPushHttpsAgent binds validated lookup on the actual Agent", async () => {
  let seenHost = null;
  const resolveAll = async (hostname) => {
    seenHost = hostname;
    return [{ address: "8.8.8.8", family: 4 }];
  };
  const agent = target.createPushHttpsAgent(resolveAll);
  assert.equal(agent.options.keepAlive, false);
  assert.equal(agent.options.maxSockets, 8);
  assert.equal(typeof agent.options.lookup, "function");
  assert.equal(agent.options.proxy, undefined);
  assert.equal(agent.proxy, undefined);

  const result = await callLookup(agent.options.lookup, "fcm.googleapis.com", { all: false });
  assert.deepEqual(result, { address: "8.8.8.8", family: 4 });
  assert.equal(seenHost, "fcm.googleapis.com");

  // Injected resolver sees hostname only at lookup time (socket path), not earlier.
  seenHost = null;
  const lookup = target.createValidatedLookup(async (hostname) => {
    seenHost = hostname;
    return [{ address: "1.1.1.1", family: 4 }];
  });
  assert.equal(seenHost, null);
  await callLookup(lookup, "updates.push.services.mozilla.com");
  assert.equal(seenHost, "updates.push.services.mozilla.com");
});

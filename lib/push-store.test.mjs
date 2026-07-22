import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createHmac } from "node:crypto";
import {
  chmod as fsChmod,
  readFile as fsReadFile,
  rename as fsRename,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const mod = await jiti.import("./push-store.ts");
const dirs = [];

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function makeStore(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pi-push-store-"));
  dirs.push(dir);
  const statePath = join(dir, "pi-web-push.json");
  const store = new mod.PushStore({
    statePath,
    now: () => new Date("2026-07-22T00:00:00.000Z"),
    generateVapidKeys: () => ({ publicKey: "public-key", privateKey: "private-key" }),
    ...options,
  });
  return { dir, statePath, store };
}

function independentFingerprint(password, vapidPrivateKey) {
  return createHmac("sha256", vapidPrivateKey)
    .update("pi-web-push-auth-v1")
    .update("\0")
    .update(password)
    .digest("base64url");
}

function writeValidState(statePath, subscriptions = []) {
  writeFileSync(
    statePath,
    `${JSON.stringify({
      version: 1,
      vapid: { publicKey: "public-key", privateKey: "private-key" },
      subscriptions,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

test("computeAuthFingerprint matches independent HMAC-SHA256 domain string", () => {
  const expected = independentFingerprint("secret", "private-key");
  assert.equal(mod.computeAuthFingerprint("secret", "private-key"), expected);
  assert.notEqual(
    mod.computeAuthFingerprint("secret", "private-key"),
    mod.computeAuthFingerprint("other", "private-key"),
  );
  assert.notEqual(
    mod.computeAuthFingerprint("secret", "private-key"),
    mod.computeAuthFingerprint("secret", "other-key"),
  );
});

test("first load creates stable 0600 VAPID state through an atomic temp rename", async () => {
  const { dir, statePath, store } = makeStore();
  assert.deepEqual(await store.getVapidKeys(), { publicKey: "public-key", privateKey: "private-key" });
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
  assert.deepEqual((await new mod.PushStore({ statePath }).getVapidKeys()), {
    publicKey: "public-key", privateKey: "private-key",
  });
  assert.equal(readFileSync(statePath, "utf8").includes("private-key"), true);
  assert.deepEqual(readdirSync(dir).filter((name) => name.includes(".tmp-")), []);
  const parsed = JSON.parse(readFileSync(statePath, "utf8"));
  assert.deepEqual(parsed, {
    version: 1,
    vapid: { publicKey: "public-key", privateKey: "private-key" },
    subscriptions: [],
  });
});

test("same endpoint is globally updated and rebound without consuming a slot", async () => {
  const { store, statePath } = makeStore();
  assert.equal(await store.upsert({ endpoint: "https://push.example/a", p256dh: "k1", auth: "a1" }, "old"), "created");
  assert.equal(await store.upsert({ endpoint: "https://push.example/a", p256dh: "k2", auth: "a2" }, "new"), "updated");
  // Read-only: listAuthorized("old") would destructively reconcile and drop the rebound "new" record.
  assert.equal(await store.findAuthorized("https://push.example/a", "old"), null);
  assert.ok(await store.findAuthorized("https://push.example/a", "new"));
  const current = await store.findAuthorized("https://push.example/a", "new");
  assert.equal(current.p256dh, "k2");
  assert.equal(current.auth, "a2");
  assert.equal(current.authFingerprint, independentFingerprint("new", "private-key"));
  const disk = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(disk.subscriptions.length, 1);
  assert.equal(disk.subscriptions[0].authFingerprint, independentFingerprint("new", "private-key"));
});

test("twenty endpoints are retained and the twenty-first returns limit", async () => {
  const { store, statePath } = makeStore();
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.upsert({
    endpoint: `https://push.example/${i}`, p256dh: `k${i}`, auth: `a${i}`,
  }, "secret")));
  assert.equal((await store.listAuthorized("secret")).length, 20);
  assert.equal(await store.upsert({ endpoint: "https://push.example/20", p256dh: "k", auth: "a" }, "secret"), "limit");
  assert.equal((await store.listAuthorized("secret")).length, 20);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).subscriptions.length, 20);
  assert.equal(
    await store.upsert({ endpoint: "https://push.example/0", p256dh: "k-new", auth: "a-new" }, "secret"),
    "updated",
  );
});

test("corrupt state locks Push and is never overwritten", async () => {
  const { statePath, store } = makeStore();
  writeFileSync(statePath, "{broken", { mode: 0o600 });
  await assert.rejects(store.getPublicKey(), (error) => error.code === "PUSH_STORE_LOCKED");
  assert.equal(readFileSync(statePath, "utf8"), "{broken");
  await assert.rejects(
    store.upsert({ endpoint: "https://push.example/a", p256dh: "k", auth: "a" }, "secret"),
    (error) => error.code === "PUSH_STORE_LOCKED",
  );
  assert.equal(readFileSync(statePath, "utf8"), "{broken");
});

test("invalid schema locks Push without replacing keys or erasing subscriptions", async () => {
  const { statePath, store } = makeStore();
  const invalid = JSON.stringify({
    version: 2,
    vapid: { publicKey: "public-key", privateKey: "private-key" },
    subscriptions: [],
  });
  writeFileSync(statePath, invalid, { mode: 0o600 });
  await assert.rejects(store.getVapidKeys(), (error) => error.code === "PUSH_STORE_LOCKED");
  assert.equal(readFileSync(statePath, "utf8"), invalid);

  const missingKeys = JSON.stringify({
    version: 1,
    vapid: { publicKey: "public-key" },
    subscriptions: [{
      endpoint: "https://push.example/a",
      p256dh: "k",
      auth: "a",
      createdAt: "2026-07-22T00:00:00.000Z",
      authFingerprint: "fp",
    }],
  });
  writeFileSync(statePath, missingKeys, { mode: 0o600 });
  const store2 = new mod.PushStore({ statePath });
  await assert.rejects(store2.getPublicKey(), (error) => error.code === "PUSH_STORE_LOCKED");
  assert.equal(readFileSync(statePath, "utf8"), missingKeys);

  const dupEndpoints = JSON.stringify({
    version: 1,
    vapid: { publicKey: "public-key", privateKey: "private-key" },
    subscriptions: [
      {
        endpoint: "https://push.example/a",
        p256dh: "k1",
        auth: "a1",
        createdAt: "2026-07-22T00:00:00.000Z",
        authFingerprint: "fp1",
      },
      {
        endpoint: "https://push.example/a",
        p256dh: "k2",
        auth: "a2",
        createdAt: "2026-07-22T00:00:00.000Z",
        authFingerprint: "fp2",
      },
    ],
  });
  writeFileSync(statePath, dupEndpoints, { mode: 0o600 });
  const store3 = new mod.PushStore({ statePath });
  await assert.rejects(store3.listAuthorized("secret"), (error) => error.code === "PUSH_STORE_LOCKED");
  assert.equal(readFileSync(statePath, "utf8"), dupEndpoints);
});

test("rejects more than 20 persisted records and invalid ISO dates without overwrite", async () => {
  const { statePath } = makeStore();
  const tooMany = Array.from({ length: 21 }, (_, i) => ({
    endpoint: `https://push.example/${i}`,
    p256dh: `k${i}`,
    auth: `a${i}`,
    createdAt: "2026-07-22T00:00:00.000Z",
    authFingerprint: "fp",
  }));
  const tooManyJson = JSON.stringify({
    version: 1,
    vapid: { publicKey: "public-key", privateKey: "private-key" },
    subscriptions: tooMany,
  });
  writeFileSync(statePath, tooManyJson, { mode: 0o600 });
  const store = new mod.PushStore({ statePath });
  await assert.rejects(store.getPublicKey(), (error) => error.code === "PUSH_STORE_LOCKED");
  assert.equal(readFileSync(statePath, "utf8"), tooManyJson);

  const badDateJson = JSON.stringify({
    version: 1,
    vapid: { publicKey: "public-key", privateKey: "private-key" },
    subscriptions: [{
      endpoint: "https://push.example/a",
      p256dh: "k",
      auth: "a",
      createdAt: "not-a-date",
      authFingerprint: "fp",
    }],
  });
  writeFileSync(statePath, badDateJson, { mode: 0o600 });
  const store2 = new mod.PushStore({ statePath });
  await assert.rejects(store2.getVapidKeys(), (error) => error.code === "PUSH_STORE_LOCKED");
  assert.equal(readFileSync(statePath, "utf8"), badDateJson);

  const emptyStringJson = JSON.stringify({
    version: 1,
    vapid: { publicKey: "", privateKey: "private-key" },
    subscriptions: [],
  });
  writeFileSync(statePath, emptyStringJson, { mode: 0o600 });
  const store3 = new mod.PushStore({ statePath });
  await assert.rejects(store3.getVapidKeys(), (error) => error.code === "PUSH_STORE_LOCKED");
  assert.equal(readFileSync(statePath, "utf8"), emptyStringJson);
});

test("directory at state path fails closed and is not replaced", async () => {
  const { statePath, store } = makeStore();
  rmSync(statePath, { force: true });
  mkdirSync(statePath);
  await assert.rejects(store.getVapidKeys(), (error) => error.code === "PUSH_STORE_LOCKED");
  assert.equal(statSync(statePath).isDirectory(), true);
});

test("serialized concurrent mutations do not lose subscriptions", async () => {
  const { store, dir, statePath } = makeStore();
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.upsert({
    endpoint: `https://push.example/${i}`, p256dh: `k${i}`, auth: `a${i}`,
  }, "secret")));
  assert.equal((await store.listAuthorized("secret")).length, 12);
  const disk = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(disk.subscriptions.length, 12);
  assert.deepEqual(readdirSync(dir).filter((name) => name.includes(".tmp-")), []);
});

test("listAuthorized reconciles stale password-epoch fingerprints in one mutation", async () => {
  const { store, statePath } = makeStore();
  assert.equal(await store.upsert({ endpoint: "https://push.example/a", p256dh: "k1", auth: "a1" }, "old"), "created");
  assert.equal(await store.upsert({ endpoint: "https://push.example/b", p256dh: "k2", auth: "a2" }, "keep"), "created");
  const listed = await store.listAuthorized("keep");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].endpoint, "https://push.example/b");
  const disk = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(disk.subscriptions.length, 1);
  assert.equal(disk.subscriptions[0].endpoint, "https://push.example/b");
});

test("remove requires matching fingerprint; removeEndpoint ignores fingerprint", async () => {
  const { store, statePath } = makeStore();
  await store.upsert({ endpoint: "https://push.example/a", p256dh: "k1", auth: "a1" }, "secret");
  await store.upsert({ endpoint: "https://push.example/b", p256dh: "k2", auth: "a2" }, "secret");
  assert.equal(await store.remove("https://push.example/a", "wrong"), false);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).subscriptions.length, 2);
  assert.equal(await store.remove("https://push.example/a", "secret"), true);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).subscriptions.length, 1);
  await store.removeEndpoint("https://push.example/b");
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).subscriptions.length, 0);
});

test("restart reuses stable keys and restores authorized subscriptions", async () => {
  const { statePath } = makeStore();
  const first = new mod.PushStore({
    statePath,
    now: () => new Date("2026-07-22T00:00:00.000Z"),
    generateVapidKeys: () => ({ publicKey: "public-key", privateKey: "private-key" }),
  });
  await first.upsert({ endpoint: "https://push.example/a", p256dh: "k1", auth: "a1" }, "secret");
  const second = new mod.PushStore({
    statePath,
    generateVapidKeys: () => ({ publicKey: "other-public", privateKey: "other-private" }),
  });
  assert.deepEqual(await second.getVapidKeys(), { publicKey: "public-key", privateKey: "private-key" });
  assert.equal((await second.listAuthorized("secret")).length, 1);
  assert.equal(await second.getPublicKey(), "public-key");
});

test("existing valid state is chmodded to 0600 after load", async () => {
  const { statePath } = makeStore();
  const bootstrap = new mod.PushStore({
    statePath,
    generateVapidKeys: () => ({ publicKey: "public-key", privateKey: "private-key" }),
  });
  await bootstrap.getVapidKeys();
  chmodSync(statePath, 0o644);
  assert.equal(statSync(statePath).mode & 0o777, 0o644);
  const reloaded = new mod.PushStore({ statePath });
  await reloaded.getPublicKey();
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
});

test("chmod failure on valid state fails closed without operating or overwriting", async () => {
  const { statePath, dir } = makeStore();
  writeValidState(statePath);
  const store = new mod.PushStore({
    statePath,
    generateVapidKeys: () => ({ publicKey: "regen-public", privateKey: "regen-private" }),
    fs: {
      chmod: async () => {
        const err = new Error("EPERM");
        err.code = "EPERM";
        throw err;
      },
    },
  });
  await assert.rejects(store.getPublicKey(), (error) => error.code === "PUSH_STORE_LOCKED");
  const disk = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(disk.vapid.publicKey, "public-key");
  assert.equal(disk.vapid.privateKey, "private-key");
  assert.deepEqual(readdirSync(dir).filter((name) => name.includes(".tmp-")), []);
});

test("persist failure does not apply in-memory mutation; later mutations recover", async () => {
  const { statePath, dir } = makeStore();
  let failWrites = 0;
  const store = new mod.PushStore({
    statePath,
    now: () => new Date("2026-07-22T00:00:00.000Z"),
    generateVapidKeys: () => ({ publicKey: "public-key", privateKey: "private-key" }),
    fs: {
      writeFile: async (path, data, options) => {
        if (String(path).includes(".tmp-") && failWrites > 0) {
          failWrites -= 1;
          const err = new Error("ENOSPC");
          err.code = "ENOSPC";
          throw err;
        }
        return fsWriteFile(path, data, options);
      },
      rename: fsRename,
      unlink: fsUnlink,
      chmod: fsChmod,
      readFile: fsReadFile,
    },
  });

  assert.equal(await store.upsert({ endpoint: "https://push.example/a", p256dh: "k1", auth: "a1" }, "secret"), "created");
  failWrites = 1;
  await assert.rejects(
    store.upsert({ endpoint: "https://push.example/b", p256dh: "k2", auth: "a2" }, "secret"),
    (error) => error && error.code === "ENOSPC",
  );
  // No phantom in-memory mutation: only the first subscription remains.
  assert.equal(await store.findAuthorized("https://push.example/b", "secret"), null);
  assert.ok(await store.findAuthorized("https://push.example/a", "secret"));
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).subscriptions.length, 1);
  assert.deepEqual(readdirSync(dir).filter((name) => name.includes(".tmp-")), []);

  // Queue recovers for a subsequent successful mutation.
  assert.equal(await store.upsert({ endpoint: "https://push.example/b", p256dh: "k2", auth: "a2" }, "secret"), "created");
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).subscriptions.length, 2);
  assert.ok(await store.findAuthorized("https://push.example/b", "secret"));
});

test("temp files use Task 2 grammar and leave no leftovers after rename", async () => {
  const { statePath, dir } = makeStore();
  const seenTemps = [];
  const store = new mod.PushStore({
    statePath,
    now: () => new Date("2026-07-22T00:00:00.000Z"),
    generateVapidKeys: () => ({ publicKey: "public-key", privateKey: "private-key" }),
    fs: {
      writeFile: async (path, data, options) => {
        if (String(path).includes(".tmp-")) seenTemps.push(String(path));
        return fsWriteFile(path, data, options);
      },
      rename: fsRename,
      unlink: fsUnlink,
      chmod: fsChmod,
      readFile: fsReadFile,
    },
  });
  await store.getVapidKeys();
  assert.ok(seenTemps.length >= 1);
  for (const temp of seenTemps) {
    assert.equal(temp.startsWith(`${statePath}.tmp-`), true);
    assert.match(temp, new RegExp(`^${statePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.tmp-\\d+-[0-9a-f-]+$`));
  }
  assert.deepEqual(readdirSync(dir).filter((name) => name.includes(".tmp-")), []);
});

test("getPushStore returns a process singleton", () => {
  const a = mod.getPushStore();
  const b = mod.getPushStore();
  assert.equal(a, b);
  assert.ok(a instanceof mod.PushStore);
});

test("errors and public outputs do not include private material", async () => {
  const { statePath, store } = makeStore();
  writeFileSync(statePath, "{broken", { mode: 0o600 });
  try {
    await store.getPublicKey();
    assert.fail("expected lock");
  } catch (error) {
    const text = String(error) + (error && error.stack ? error.stack : "");
    assert.equal(text.includes("private-key"), false);
    assert.equal(text.includes("{broken"), false);
    assert.equal(text.includes("secret"), false);
    assert.equal(text.includes(statePath), false);
  }

  const { statePath: path2 } = makeStore();
  let fail = true;
  const failing = new mod.PushStore({
    statePath: path2,
    generateVapidKeys: () => ({ publicKey: "public-key", privateKey: "private-key" }),
    fs: {
      writeFile: async (p, data, options) => {
        if (fail && String(p).includes(".tmp-")) {
          fail = false;
          const err = new Error("disk full");
          err.code = "ENOSPC";
          throw err;
        }
        return fsWriteFile(p, data, options);
      },
    },
  });
  try {
    await failing.getVapidKeys();
    assert.fail("expected fail");
  } catch (error) {
    const text = String(error) + (error && error.stack ? error.stack : "");
    assert.equal(text.includes("private-key"), false);
    assert.equal(text.includes("public-key"), false);
    assert.equal(text.includes(path2), false);
    assert.equal(text.includes(".tmp-"), false);
  }
});

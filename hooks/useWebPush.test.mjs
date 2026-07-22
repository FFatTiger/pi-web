import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const hook = await jiti.import("./useWebPush.ts");

test("converts unpadded VAPID base64url to exact bytes", () => {
  const input = Buffer.from([1, 2, 3, 250, 251, 252]).toString("base64url");
  assert.deepEqual([...hook.urlBase64ToUint8Array(input)], [1, 2, 3, 250, 251, 252]);
});

test("serializes only endpoint and browser subscription keys", () => {
  const subscription = {
    endpoint: "https://push.example/a",
    getKey(name) {
      return name === "p256dh"
        ? Uint8Array.from([1, 2]).buffer
        : Uint8Array.from([3, 4]).buffer;
    },
    toJSON() {
      return { endpoint: this.endpoint, keys: { p256dh: "leak", auth: "leak" }, extra: true };
    },
  };
  assert.deepEqual(hook.serializePushSubscription(subscription), {
    endpoint: "https://push.example/a",
    keys: { p256dh: "AQI", auth: "AwQ" },
  });
});

test("serialization rejects subscriptions without both browser keys", () => {
  assert.throws(() => hook.serializePushSubscription({
    endpoint: "https://push.example/a",
    getKey() { return null; },
  }));
});

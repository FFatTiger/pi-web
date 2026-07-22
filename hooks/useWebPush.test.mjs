import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const hook = await jiti.import("./useWebPush.ts");
const source = readFileSync(new URL("./useWebPush.ts", import.meta.url), "utf8");

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

test("auto prompt policy uses versioned marker and only default permission", () => {
  assert.equal(hook.AUTO_PROMPT_KEY, "pi-web:push-auto-prompt-v1");
  assert.equal(hook.shouldAttemptAutoPrompt("default", false), true);
  assert.equal(hook.shouldAttemptAutoPrompt("default", true), false);
  assert.equal(hook.shouldAttemptAutoPrompt("granted", false), false);
  assert.equal(hook.shouldAttemptAutoPrompt("denied", false), false);
  assert.equal(hook.shouldAttemptAutoPrompt("unsupported", false), false);
});

test("headless auto-permission source contract", () => {
  assert.match(source, /const AUTO_PROMPT_KEY = "pi-web:push-auto-prompt-v1"/);
  assert.match(source, /Notification\.permission === "default"/);
  assert.ok(
    source.indexOf("localStorage.setItem(AUTO_PROMPT_KEY") <
      source.indexOf("Notification.requestPermission()"),
  );
  assert.doesNotMatch(source, /requestPermission[\s\S]*const enable = useCallback/);
  assert.doesNotMatch(source, /const enable = useCallback/);
  assert.match(source, /requirePushServer\(\)/);
  assert.match(source, /Notification\.requestPermission\(\)/);
  assert.match(source, /getOrCreateSubscription/);
  assert.match(source, /postSubscription/);
  assert.match(source, /PUSH_SUBSCRIPTION_CHANGED/);
});

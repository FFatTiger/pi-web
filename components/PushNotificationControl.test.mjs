import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(new URL("../hooks/useWebPush.ts", import.meta.url), "utf8");
const control = readFileSync(new URL("./PushNotificationControl.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("notification permission is requested only inside the explicit enable action", () => {
  const enableStart = hook.indexOf("const enable");
  const disableStart = hook.indexOf("const disable", enableStart);
  assert.ok(enableStart >= 0 && disableStart > enableStart);
  const enableBlock = hook.slice(enableStart, disableStart);
  assert.match(enableBlock, /Notification\.requestPermission\(\)/);
  assert.equal(
    enableBlock.indexOf("await "),
    enableBlock.indexOf("await Notification.requestPermission()"),
    "permission request must be the first awaited operation after the user click",
  );
  assert.doesNotMatch(hook.slice(0, enableStart), /requestPermission/);
});

test("mount reconciliation uses granted permission and never silently requests it", () => {
  assert.match(hook, /Notification\.permission/);
  assert.match(hook, /pushManager\.getSubscription\(\)/);
  assert.match(hook, /pi-web:push-enabled/);
  assert.match(hook, /PUSH_SUBSCRIPTION_CHANGED/);
  assert.match(hook, /serviceWorker\?\.addEventListener\("message"/);
});

test("control exposes enable, disable, test, denial, and iOS guidance and is mounted by AppShell", () => {
  for (const text of [
    "Enable completion notifications",
    "Disable notifications",
    "Send test notification",
    "browser or system settings",
    "Add Pi Web to the Home Screen before enabling notifications",
  ]) assert.match(control, new RegExp(text));
  assert.match(shell, /<PushNotificationControl/);
  assert.match(shell, /<AuthControls/);
});

test("browser actions call only protected Push APIs with JSON", () => {
  for (const path of [
    "/api/push/status",
    "/api/push/vapid-public-key",
    "/api/push/subscribe",
    "/api/push/test",
  ]) assert.match(hook, new RegExp(path.replaceAll("/", "\\/")));
  assert.match(hook, /sendJson\("\/api\/push\/subscribe",\s*"DELETE"/);
  assert.match(hook, /content-type":\s*"application\/json"/i);
});

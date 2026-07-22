import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const pwa = await jiti.import("./pwa-lifecycle.ts");

test("detects iOS and standalone without treating ordinary Safari as installed", () => {
  assert.equal(pwa.isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)", "iPhone", 5), true);
  assert.equal(pwa.isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 5), true);
  assert.equal(pwa.isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 0), false);
  assert.equal(pwa.isIosDevice("Mozilla/5.0 (Linux; Android 14) Chrome/123", "Linux armv8l", 5), false);
  assert.equal(pwa.isStandaloneDisplay(true, false), true);
  assert.equal(pwa.isStandaloneDisplay(false, true), true);
  assert.equal(pwa.isStandaloneDisplay(false, false), false);
});

test("only the tab that requested activation reloads on controllerchange", () => {
  assert.equal(pwa.controllerChangeAction(true), "reload");
  assert.equal(pwa.controllerChangeAction(false), "prompt");
});

test("first control acquisition is ignored; later controllerchange distinguishes confirming vs other tabs", () => {
  // First install / clients.claim() when there was no prior controller must not
  // look like an update activated elsewhere.
  assert.equal(pwa.controllerChangeAction(false, false), "ignore");
  assert.equal(pwa.controllerChangeAction(true, false), "ignore");
  // After a controller already existed: confirming tab reloads, others prompt.
  assert.equal(pwa.controllerChangeAction(true, true), "reload");
  assert.equal(pwa.controllerChangeAction(false, true), "prompt");
});

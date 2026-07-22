import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const route = await jiti.import("./route.ts");
const runningEvents = await jiti.import("../../../../../lib/running-events.ts");

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("route exposes only Next-supported runtime exports", () => {
  const names = [
    ...routeSource.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g),
    ...routeSource.matchAll(/export\s+const\s+(\w+)/g),
  ].map((match) => match[1]).sort();
  assert.deepEqual(names, ["GET", "dynamic", "runtime"]);
  assert.equal(typeof route.GET, "function");
});

test("running stream sends connected then running and unregisters on abort", async () => {
  const calls = [];
  const controller = new AbortController();
  const handler = runningEvents.createRunningEventsHandler({
    createConnectionId: () => "c1",
    getAuthFingerprint: async () => "fp",
    registry: {
      register: (...args) => calls.push(["register", ...args]),
      unregister: (...args) => calls.push(["unregister", ...args]),
    },
    getRunningIds: () => ["s1"],
    subscribe: () => () => calls.push(["unsubscribe"]),
  });
  const response = await handler(new Request("https://pi.example/api/agent/running/events", { signal: controller.signal }));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes('"type":"running"')) text += decoder.decode((await reader.read()).value);
  assert.ok(text.indexOf('"type":"connected"') < text.indexOf('"type":"running"'));
  assert.ok(text.includes('"connectionId":"c1"'));
  assert.ok(calls.some(([name, id, fingerprint]) => name === "register" && id === "c1" && fingerprint === "fp"));
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some(([name, id]) => name === "unregister" && id === "c1"));
  assert.ok(calls.some(([name]) => name === "unsubscribe"));
});

test("running stream continues without presence when fingerprint unavailable", async () => {
  const calls = [];
  const controller = new AbortController();
  const handler = runningEvents.createRunningEventsHandler({
    createConnectionId: () => "c1",
    getAuthFingerprint: async () => null,
    registry: {
      register: (...args) => calls.push(["register", ...args]),
      unregister: (...args) => calls.push(["unregister", ...args]),
    },
    getRunningIds: () => [],
    subscribe: () => () => calls.push(["unsubscribe"]),
  });
  const response = await handler(new Request("https://pi.example/api/agent/running/events", { signal: controller.signal }));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes('"type":"running"')) text += decoder.decode((await reader.read()).value);
  assert.ok(text.includes('"type":"connected"'));
  assert.ok(text.includes('"type":"running"'));
  assert.equal(calls.some(([name]) => name === "register"), false);
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.some(([name]) => name === "unregister"), false);
  assert.ok(calls.some(([name]) => name === "unsubscribe"));
});

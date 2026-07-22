import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { default: nextConfig } = await jiti.import("../next.config.ts");

test("sw.js is revalidated and granted root scope", async () => {
  const rules = await nextConfig.headers();
  const sw = rules.find((rule) => rule.source === "/sw.js");
  assert.ok(sw);
  const headers = Object.fromEntries(sw.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(headers["cache-control"], "no-cache, max-age=0, must-revalidate");
  assert.equal(headers["service-worker-allowed"], "/");
});

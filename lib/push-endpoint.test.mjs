import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const endpoint = await jiti.import("./push-endpoint.ts");

test("accepts only an exact basic HTTPS endpoint object", () => {
  assert.equal(
    endpoint.parseBasicPushEndpoint({ endpoint: "https://push.example/a" }),
    "https://push.example/a",
  );
  assert.equal(
    endpoint.parseBasicPushEndpoint({ endpoint: `https://push.example/${"x".repeat(4067)}` })?.length > 0,
    true,
  );

  for (const value of [
    null,
    [],
    {},
    { endpoint: "" },
    { endpoint: 3 },
    { endpoint: "http://push.example/a" },
    { endpoint: "https://user@push.example/a" },
    { endpoint: "https://:pass@push.example/a" },
    { endpoint: "https://push.example/a", extra: true },
    { endpoint: `https://push.example/${"x".repeat(4097)}` },
  ]) {
    assert.equal(endpoint.parseBasicPushEndpoint(value), null, JSON.stringify(value));
  }
});

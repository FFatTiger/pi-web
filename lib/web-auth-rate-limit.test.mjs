import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const limiter = await jiti.import("./web-auth-rate-limit.ts");
afterEach(() => limiter.resetLoginRateLimitForTests());

test("first failures add bounded progressive delays", () => {
  const now = 1_700_000_000_000;
  assert.equal(limiter.recordLoginFailure("client", now), 1);
  assert.equal(limiter.getLoginRetryAfterSeconds("client", now), 1);
  assert.equal(limiter.recordLoginFailure("client", now + 1_000), 2);
  for (let i = 0; i < 20; i += 1) limiter.recordLoginFailure("client", now + 2_000 + i);
  assert.ok(limiter.getLoginRetryAfterSeconds("client", now + 2_000) <= 30);
});

test("success clears failures and expired records disappear", () => {
  const now = 1_700_000_000_000;
  limiter.recordLoginFailure("client", now);
  limiter.clearLoginFailures("client");
  assert.equal(limiter.getLoginRetryAfterSeconds("client", now), 0);
  limiter.recordLoginFailure("other", now);
  assert.equal(limiter.getLoginRetryAfterSeconds("other", now + 16 * 60 * 1000), 0);
});

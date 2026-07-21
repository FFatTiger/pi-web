import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const session = await jiti.import("./web-auth-session.ts");

test("compares correct and differently-sized passwords without throwing", () => {
  assert.equal(session.passwordsMatch("secret", "secret"), true);
  assert.equal(session.passwordsMatch("x", "much-longer-secret"), false);
  assert.equal(session.passwordsMatch("much-longer-secret", "x"), false);
});

test("creates a token that contains no plaintext password and verifies before expiry", () => {
  const now = 1_700_000_000_000;
  const token = session.createSessionToken("secret", { now, nonce: "fixed-nonce" });
  assert.equal(token.includes("secret"), false);
  assert.equal(session.verifySessionToken(token, "secret", now + 1_000), true);
});

test("rejects tampering, expiry, malformed values, and password changes", () => {
  const now = 1_700_000_000_000;
  const token = session.createSessionToken("old-secret", { now, nonce: "fixed-nonce" });
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal(session.verifySessionToken(tampered, "old-secret", now), false);
  assert.equal(session.verifySessionToken(token, "new-secret", now), false);
  assert.equal(session.verifySessionToken(token, "old-secret", now + 31 * 24 * 60 * 60 * 1000), false);
  assert.equal(session.verifySessionToken("broken", "old-secret", now), false);
  assert.equal(session.verifySessionToken(undefined, "old-secret", now), false);
});

test("sets secure cookies only for HTTPS and expires with maxAge zero", () => {
  assert.deepEqual(session.getSessionCookieOptions("http://localhost:30141"), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: session.WEB_AUTH_MAX_AGE_SECONDS,
  });
  assert.equal(session.getSessionCookieOptions("https://pi.example").secure, true);
  assert.equal(session.getExpiredSessionCookieOptions("https://pi.example").maxAge, 0);
});

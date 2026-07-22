import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./request-security.ts");
}

test("allows same-origin and non-browser API requests", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  assert.equal(isApiRequestOriginAllowed(new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: { origin: "http://localhost:30141", "sec-fetch-site": "same-origin" },
  })), true);
  assert.equal(isApiRequestOriginAllowed(new Request("http://localhost:30141/api/test", { method: "POST" })), true);
});

test("rejects cross-origin browser API requests", async () => {
  const { isApiRequestOriginAllowed, shouldCheckApiRequestOrigin } = await loadSubject();
  const post = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  });
  const crossSiteGet = new Request("http://localhost:30141/api/sessions", {
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(shouldCheckApiRequestOrigin(post), true);
  assert.equal(isApiRequestOriginAllowed(post), false);
  assert.equal(shouldCheckApiRequestOrigin(crossSiteGet), true);
  assert.equal(isApiRequestOriginAllowed(crossSiteGet), false);
});

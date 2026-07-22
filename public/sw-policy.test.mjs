import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./sw.js", import.meta.url), "utf8");

test("service worker precaches only public PWA resources", () => {
  assert.match(source, /"\/offline\.html"/);
  assert.match(source, /"\/manifest\.webmanifest"/);
  assert.match(source, /"\/icons\/icon-192\.png"/);
  assert.doesNotMatch(source, /_next\/static|\/api\/|\/login/);
});

test("only exact public PWA assets use Cache Storage", () => {
  assert.match(source, /PRECACHE_PATHS\.has\(url\.pathname\)/);
  assert.match(source, /caches\.match\(request\)/);
  assert.doesNotMatch(source, /cache\.put|caches\.open.*fetch/);
});

test("navigation fallback happens only on a rejected network request", () => {
  assert.match(source, /request\.mode === "navigate"/);
  assert.match(source, /fetch\(request\)\.catch/);
  assert.match(source, /new Response\([\s\S]*You are offline/);
  assert.doesNotMatch(source, /response\.status\s*===\s*(401|403|503)/);
});

test("waiting workers skip only after an explicit message", () => {
  assert.doesNotMatch(source.slice(source.indexOf('addEventListener("install"'), source.indexOf('addEventListener("activate"')), /skipWaiting/);
  assert.match(source, /data\?\.type === "SKIP_WAITING"/);
  assert.match(source, /self\.skipWaiting\(\)/);
});

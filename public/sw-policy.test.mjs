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

test("Push rendering accepts only fixed v1 branches and never trusts payload copy or URLs", () => {
  assert.match(source, /addEventListener\("push"/);
  assert.match(source, /kind === "agent"/);
  assert.match(source, /kind === "test"/);
  assert.match(source, /Agent run finished/);
  assert.match(source, /Test notification delivered/);
  assert.match(source, /Object\.keys/);
  assert.doesNotMatch(source, /payload\.(title|body|tag|url|actions)/);
  assert.match(source, /showNotification/);
  assert.match(source, /"\/icons\/icon-192\.png"/);
  assert.match(source, /"\/icons\/badge-96\.png"/);
});

test("notification clicks construct local destinations and use only same-origin clients", () => {
  assert.match(source, /addEventListener\("notificationclick"/);
  assert.match(source, /encodeURIComponent\(payload\.sessionId\)/);
  assert.match(source, /clients\.matchAll/);
  assert.match(source, /includeUncontrolled:\s*true/);
  assert.match(source, /new URL\(client\.url\)\.origin === self\.location\.origin/);
  assert.match(source, /existing\.navigate\(target\)/);
  assert.match(source, /existing\.focus\(\)/);
  assert.match(source, /clients\.openWindow\(target\)/);
});

test("subscription change only notifies same-origin windows for authenticated reconciliation", () => {
  assert.match(source, /addEventListener\("pushsubscriptionchange"/);
  assert.match(source, /PUSH_SUBSCRIPTION_CHANGED/);
  assert.match(source, /client\.postMessage/);
  assert.doesNotMatch(source, /requestPermission/);
});

test("Push payloads never enter Cache Storage", () => {
  assert.doesNotMatch(source, /push[\s\S]{0,500}cache\.put|notification[\s\S]{0,500}cache\.put/i);
  assert.doesNotMatch(source, /PRECACHE_URLS[\s\S]*\/api\/push/);
});

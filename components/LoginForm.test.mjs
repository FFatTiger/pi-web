import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const formSource = readFileSync(new URL("./LoginForm.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");

test("LoginForm fetches gate status and login endpoints", () => {
  assert.match(formSource, /fetch\("\/api\/gate\/status"/);
  assert.match(formSource, /fetch\("\/api\/gate\/login"/);
});

test("LoginForm password field is browser-friendly", () => {
  assert.match(formSource, /autoComplete="current-password"/);
  assert.match(formSource, /type="password"/);
});

test("LoginForm surfaces config and error guidance safely", () => {
  assert.match(formSource, /PI_WEB_PASSWORD/);
  assert.match(formSource, /PI_WEB_AUTH_DISABLED/);
  assert.match(formSource, /认证配置无法读取/);
  assert.match(formSource, /window\.location\.assign\(data\.next\)/);
});

test("login page wraps LoginForm in Suspense", () => {
  assert.match(pageSource, /<Suspense/);
  assert.match(pageSource, /<LoginForm/);
});

test("LoginForm does not leak secrets or raw server errors", () => {
  assert.doesNotMatch(formSource, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(formSource, /NEXT_PUBLIC/);
  assert.doesNotMatch(formSource, /logMessage/);
  assert.doesNotMatch(formSource, /JSON\.stringify\(data\)/);
  assert.doesNotMatch(formSource, /String\(error\)/);
});

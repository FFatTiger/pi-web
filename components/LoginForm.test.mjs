import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const formSource = readFileSync(new URL("./LoginForm.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `missing start marker: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `missing end marker after ${startNeedle}: ${endNeedle}`);
  return source.slice(start, end);
}

test("LoginForm fetches gate status and login endpoints", () => {
  assert.match(formSource, /fetch\("\/api\/gate\/status"/);
  assert.match(formSource, /fetch\("\/api\/gate\/login"/);
});

test("status fetch uses cache no-store", () => {
  assert.match(
    formSource,
    /fetch\("\/api\/gate\/status",\s*\{\s*cache:\s*"no-store"\s*\}\)/,
  );
});

test("login submit body includes password and next", () => {
  const submitBlock = sliceBetween(
    formSource,
    "async function handleSubmit",
    "return (",
  );
  assert.match(submitBlock, /fetch\("\/api\/gate\/login"/);
  assert.match(
    submitBlock,
    /JSON\.stringify\(\{\s*password,\s*next:\s*resolvedNextPath\s*\}\)/,
  );
});

test("successful login navigates only to server data.next", () => {
  const submitBlock = sliceBetween(
    formSource,
    "async function handleSubmit",
    "return (",
  );
  assert.match(submitBlock, /window\.location\.assign\(data\.next\)/);
  assert.doesNotMatch(submitBlock, /window\.location\.assign\(resolvedNextPath\)/);
  assert.doesNotMatch(submitBlock, /window\.location\.assign\(nextPath\)/);
  assert.doesNotMatch(submitBlock, /window\.location\.href\s*=/);
});

test("401 clears password and 429 uses retryAfterSeconds", () => {
  const submitBlock = sliceBetween(
    formSource,
    "async function handleSubmit",
    "return (",
  );
  assert.match(submitBlock, /response\.status === 401/);
  assert.match(submitBlock, /setPassword\(""\)/);
  assert.match(submitBlock, /response\.status === 429/);
  assert.match(submitBlock, /retryAfterSeconds/);
});

test("LoginForm password field is browser-friendly", () => {
  assert.match(formSource, /autoComplete="current-password"/);
  assert.match(formSource, /type="password"/);
});

test("only enabled branch renders the password form", () => {
  const enabledBranch = sliceBetween(
    formSource,
    'status.status === "enabled"',
    'status.status === "unconfigured"',
  );
  const unconfiguredBranch = sliceBetween(
    formSource,
    'status.status === "unconfigured"',
    'status.status === "error"',
  );
  const errorBranch = sliceBetween(
    formSource,
    'status.status === "error"',
    ") : (",
  );

  assert.match(enabledBranch, /<form\b/);
  assert.match(enabledBranch, /type="password"/);
  assert.doesNotMatch(unconfiguredBranch, /<form\b/);
  assert.doesNotMatch(unconfiguredBranch, /type="password"/);
  assert.doesNotMatch(errorBranch, /<form\b/);
  assert.doesNotMatch(errorBranch, /type="password"/);
});

test("scroll layout keeps long content reachable without vertical flex center", () => {
  const outerStyleStart = formSource.indexOf("minHeight: \"100dvh\"");
  assert.ok(outerStyleStart >= 0);
  const outerStyle = formSource.slice(outerStyleStart, formSource.indexOf("<div style={cardStyle}>"));
  assert.match(outerStyle, /overflowY:\s*"auto"/);
  assert.match(outerStyle, /minHeight:\s*"100dvh"/);
  assert.doesNotMatch(outerStyle, /alignItems:\s*"center"/);
  assert.doesNotMatch(outerStyle, /justifyContent:\s*"center"/);
  assert.match(formSource, /margin:\s*"auto"/);
});

test("login errors and busy states are announced accessibly", () => {
  assert.match(formSource, /role="alert"|aria-live="polite"/);
  assert.match(formSource, /正在读取认证配置…|aria-busy|aria-live/);
  assert.match(formSource, /disabled=\{submitting\}/);
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

test("disabled state uses next/link for home navigation", () => {
  assert.match(formSource, /import Link from "next\/link"/);
  assert.match(formSource, /<Link\s+href="\/"/);
  assert.doesNotMatch(formSource, /<a\s+href="\/"/);
});

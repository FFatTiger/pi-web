import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const requiredDocs = ["README.md", "README.zh-CN.md", "AGENTS.md", "docs/pwa-web-push-acceptance.md"];

test("documentation names Push configuration and browser constraints", () => {
  const combined = requiredDocs.map((path) => readFileSync(path, "utf8")).join("\n");
  for (const text of [
    "PI_WEB_PUSH_DISABLED", "PI_WEB_PUSH_SUBJECT", "pi-web-push.json",
    "HTTPS", "localhost", "iOS 16.4", "agent_settled", "Service Worker",
  ]) assert.match(combined, new RegExp(text.replace(".", "\\."), "i"), text);
});

test("npm package includes every public PWA artifact", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const files = new Set(JSON.parse(result.stdout)[0].files.map(({ path }) => path));
  for (const path of [
    "app/manifest.ts", "public/sw.js", "public/offline.html", "public/icons/icon-192.png",
    "public/icons/icon-512.png", "public/icons/maskable-512.png",
    "public/icons/apple-touch-icon.png", "public/icons/badge-96.png",
  ]) assert.equal(files.has(path), true, path);
});

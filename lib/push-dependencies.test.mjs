import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

test("web-push ships as a runtime dependency with declarations", () => {
  assert.equal(pkg.dependencies["web-push"], "3.6.7");
  assert.equal(pkg.devDependencies["@types/web-push"], "3.6.4");
  assert.match(config, /"web-push"/);
});

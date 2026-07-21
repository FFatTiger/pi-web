import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const configSource = readFileSync(new URL("./next.config.ts", import.meta.url), "utf8");

test("allows the public development origin used by the HMR websocket", () => {
  assert.match(
    configSource,
    /allowedDevOrigins\s*:\s*\[[^\]]*["']pi\.huu\.im["']/s,
    "pi.huu.im must be allowed so Next.js accepts /_next/webpack-hmr",
  );
});

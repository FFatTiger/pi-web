import assert from "node:assert/strict";
import test from "node:test";
import { encodeFilePathForApi, normalizeFilePathSlashes } from "./file-paths.ts";

test("watch key isolates session and path", () => {
  const keyA = `${""}::${normalizeFilePathSlashes("/repo/a.ts")}`;
  const keyB = `${"sess"}::${normalizeFilePathSlashes("/repo/a.ts")}`;
  assert.notEqual(keyA, keyB);
  assert.equal(encodeFilePathForApi("/repo/a.ts").includes("a.ts"), true);
});

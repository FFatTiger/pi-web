import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./[...path]/route.ts", import.meta.url), "utf8");

test("files route denies secrets before root and session-reference authorization", () => {
  const deny = source.indexOf("isResolvedFilePathDenied(filePath)");
  const root = source.indexOf("isFilePathAllowed(filePath, allowedRoots)");
  const reference = source.indexOf("isFilePathReferencedBySession(filePath, sessionId)");
  assert.ok(deny >= 0 && deny < root && deny < reference);
});

test("files route filters listings and upload destinations with the same deny helper", () => {
  assert.match(source, /isResolvedFilePathDenied\(path\.join\(filePath, d\.name\)\)/);
  assert.match(source, /isResolvedFilePathDenied\(destination\)/);
});

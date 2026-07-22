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

test("upload and upload-check deny secrets before inspectUploadTargets", () => {
  const post = source.slice(source.indexOf("export async function POST"));
  let from = 0;
  let count = 0;
  while (true) {
    const inspect = post.indexOf("inspectUploadTargets(directory, fileNames)", from);
    if (inspect < 0) break;
    const before = post.slice(0, inspect);
    // Nearest deny preflight must precede this inspect; no inspectUploadTargets between them.
    const deny = before.lastIndexOf("isResolvedFilePathDenied(");
    assert.ok(deny >= 0, "expected isResolvedFilePathDenied before inspectUploadTargets");
    const intervening = before.slice(deny).includes("inspectUploadTargets(");
    assert.equal(intervening, false);
    count += 1;
    from = inspect + 1;
  }
  assert.equal(count, 2, "expected upload-check and upload to both call inspectUploadTargets");
});

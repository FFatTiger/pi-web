import assert from "node:assert/strict";
import test from "node:test";
import {
  getFileDirectory,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} from "./file-paths.ts";

// Mirror buildFileBreadcrumbs without TS path aliases so node:test can import.
function buildFileBreadcrumbs(filePath, cwd) {
  const normalizedFile = normalizeFilePathSlashes(filePath);
  const relative = getRelativeFilePath(normalizedFile, cwd);
  const parts = relative.split("/").filter(Boolean);
  if (parts.length === 0) {
    return [{ label: normalizedFile, path: normalizedFile, kind: "file" }];
  }
  const segments = [];
  const normalizedCwd = cwd ? normalizeFilePathSlashes(cwd).replace(/\/$/, "") : "";
  if (normalizedCwd) {
    const rootLabel = normalizedCwd.split("/").filter(Boolean).pop() ?? normalizedCwd;
    segments.push({ label: rootLabel, path: normalizedCwd, kind: "root" });
  }
  let acc = normalizedCwd;
  for (let i = 0; i < parts.length; i += 1) {
    const label = parts[i];
    acc = acc ? joinFilePath(acc, label) : label;
    const isLast = i === parts.length - 1;
    segments.push({ label, path: acc, kind: isLast ? "file" : "directory" });
  }
  return segments;
}

function directoryPathForBreadcrumb(segment) {
  if (segment.kind === "file") return getFileDirectory(segment.path) || null;
  return segment.path;
}

test("buildFileBreadcrumbs splits relative path under cwd", () => {
  const segs = buildFileBreadcrumbs("/repo/src/app/page.tsx", "/repo");
  assert.deepEqual(segs.map((s) => s.label), ["repo", "src", "app", "page.tsx"]);
  assert.equal(segs[0].kind, "root");
  assert.equal(segs[1].kind, "directory");
  assert.equal(segs[3].kind, "file");
  assert.equal(segs[2].path, "/repo/src/app");
});

test("directoryPathForBreadcrumb maps file to parent", () => {
  const segs = buildFileBreadcrumbs("/repo/README.md", "/repo");
  const file = segs[segs.length - 1];
  assert.equal(directoryPathForBreadcrumb(file), "/repo");
  assert.equal(directoryPathForBreadcrumb(segs[0]), "/repo");
});

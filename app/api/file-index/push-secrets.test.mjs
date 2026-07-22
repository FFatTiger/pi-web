import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("file-index sanitizes listings with the shared deny filter before cache and response", () => {
  assert.match(source, /filterDeniedFileIndexPaths/);
  assert.match(source, /FILE_INDEX_CACHE_VERSION/);

  const filterAt = source.indexOf("filterDeniedFileIndexPaths");
  const cacheSetAt = source.indexOf("cache.set(cwd, cached)");
  const responseFilesAt = source.indexOf("files: files.slice(0, MAX_FILES)");
  const matchesAt = source.indexOf("filterFileEntries(cached.entries, query)");

  assert.ok(filterAt >= 0, "must use filterDeniedFileIndexPaths");
  assert.ok(cacheSetAt >= 0 && filterAt < cacheSetAt, "must sanitize before writing cache");
  assert.ok(responseFilesAt >= 0, "must serve files from sanitized listing");
  assert.ok(matchesAt >= 0, "must search sanitized listing");
});

test("file-index invalidates hot-reload cache when sanitization version changes", () => {
  assert.match(
    source,
    /__piFileIndexCacheVersion[\s\S]*FILE_INDEX_CACHE_VERSION|FILE_INDEX_CACHE_VERSION[\s\S]*__piFileIndexCacheVersion/,
  );
  assert.match(source, /__piFileIndexCache\s*=\s*new Map/);
});

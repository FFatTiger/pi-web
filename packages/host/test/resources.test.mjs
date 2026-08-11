import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createAllowedRootService,
  createFileWatchManager,
  createHostApp,
  createProcessRunner,
  parseSingleRange,
} from "../dist/index.js";

const temporary = [];
const gate = { config: { read: () => ({ status: "disabled", source: "test" }) } };
function temp(prefix) { const value = mkdtempSync(join(tmpdir(), prefix)); temporary.push(value); return value; }
afterEach(() => { while (temporary.length) rmSync(temporary.pop(), { recursive: true, force: true }); });

async function fixture(options = {}) {
  const root = temp("pi-host-resources-");
  const allowedRoots = await createAllowedRootService({ roots: [root], allowLocalExpansion: true, ...options.policy });
  const host = createHostApp({ logger: {}, gate, exposureMode: options.exposureMode ?? "local", resources: { allowedRoots, ...options.resources } });
  return { root, allowedRoots, host, app: host.app };
}
function headers(extra = {}) { return { host: "localhost", ...extra }; }
function git(cwd, args) { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } }).trim(); }
function initRepo(root) {
  git(root, ["init", "-q"]); git(root, ["config", "user.email", "test@example.com"]); git(root, ["config", "user.name", "Test"]);
  writeFileSync(join(root, "tracked.txt"), "one\n"); git(root, ["add", "tracked.txt"]); git(root, ["commit", "-qm", "initial"]);
}

test("AllowedRootService canonicalizes roots and rejects final/parent symlink escapes", async () => {
  const { root, allowedRoots } = await fixture();
  const outside = temp("pi-host-outside-"); writeFileSync(join(outside, "secret.txt"), "SECRET");
  symlinkSync(join(outside, "secret.txt"), join(root, "secret-link")); symlinkSync(outside, join(root, "dir-link"), "dir");
  await assert.rejects(() => allowedRoots.authorizeExisting(join(root, "secret-link")), (e) => e.code === "PATH_FORBIDDEN");
  await assert.rejects(() => allowedRoots.authorizeExisting(join(root, "dir-link", "secret.txt")), (e) => e.code === "PATH_FORBIDDEN");
  await assert.rejects(() => allowedRoots.authorizeChild(root, "../evil"), (e) => e.code === "INVALID_FILE_NAME");
  await assert.rejects(() => allowedRoots.authorizeChild(root, "a\\b"), (e) => e.code === "INVALID_FILE_NAME");
});

test("AllowedRootService fails closed when an allowed root path is replaced", async () => {
  const { root, allowedRoots } = await fixture(); writeFileSync(join(root, "before.txt"), "ok");
  const moved = `${root}-moved`; temporary.push(moved); renameSync(root, moved); mkdirSync(root); writeFileSync(join(root, "after.txt"), "unsafe");
  await assert.rejects(() => allowedRoots.authorizeExisting(join(root, "after.txt"), "file"), (e) => e.code === "ROOT_REPLACED" || e.code === "PATH_FORBIDDEN");
});

test("AllowedRootService allows ordinary in-root mutations", async () => {
  const { root, allowedRoots } = await fixture(); const file = join(root, "mutable.txt"); writeFileSync(file, "one");
  assert.equal((await allowedRoots.authorizeExisting(file, "file")).root, await import("node:fs/promises").then(({ realpath }) => realpath(root)));
  writeFileSync(file, "two"); assert.equal((await allowedRoots.authorizeExisting(file, "file")).canonicalPath, await import("node:fs/promises").then(({ realpath }) => realpath(file)));
  rmSync(file); writeFileSync(join(root, "replacement.txt"), "three"); assert.equal((await allowedRoots.authorizeExisting(join(root, "replacement.txt"), "file")).root, await import("node:fs/promises").then(({ realpath }) => realpath(root)));
});

test("AllowedRootService fails closed for delete/recreate, symlink swap, and rename replacement", async () => {
  for (const mode of ["delete-recreate", "symlink-swap", "rename-replacement"]) {
    const root = temp(`pi-root-${mode}-`); const roots = await createAllowedRootService({ roots: [root] }); const moved = `${root}-old`; temporary.push(moved);
    if (mode === "delete-recreate") { rmSync(root, { recursive: true }); mkdirSync(root); }
    else if (mode === "symlink-swap") { renameSync(root, moved); symlinkSync(moved, root, "dir"); }
    else { renameSync(root, moved); mkdirSync(root); }
    writeFileSync(join(root, "new.txt"), "unsafe");
    await assert.rejects(() => roots.authorizeExisting(join(root, "new.txt"), "file"), (e) => e.code === "ROOT_REPLACED" || e.code === "PATH_FORBIDDEN");
  }
});

test("file routes list/read/meta and ranges are bounded and correct", async () => {
  const { root, app } = await fixture(); writeFileSync(join(root, "hello.txt"), "hello world"); mkdirSync(join(root, "dir"));
  const list = await app.request(`http://localhost/v1/files?path=${encodeURIComponent(root)}`, { headers: headers() });
  assert.equal(list.status, 200); assert.deepEqual((await list.json()).entries.map((e) => e.name), ["dir", "hello.txt"]);
  const read = await app.request(`http://localhost/v1/files?op=read&path=${encodeURIComponent(join(root, "hello.txt"))}`, { headers: headers() });
  assert.equal(read.status, 200); assert.equal((await read.json()).content, "hello world");
  const range = await app.request(`http://localhost/v1/files?op=raw&path=${encodeURIComponent(join(root, "hello.txt"))}`, { headers: headers({ range: "bytes=6-10" }) });
  assert.equal(range.status, 206); assert.equal(range.headers.get("content-range"), "bytes 6-10/11"); assert.equal(await range.text(), "world");
  const suffix = await app.request(`http://localhost/v1/files?op=raw&path=${encodeURIComponent(join(root, "hello.txt"))}`, { headers: headers({ range: "bytes=-5" }) });
  assert.equal(await suffix.text(), "world");
  const invalid = await app.request(`http://localhost/v1/files?op=raw&path=${encodeURIComponent(join(root, "hello.txt"))}`, { headers: headers({ range: "bytes=99-100" }) });
  assert.equal(invalid.status, 416); assert.equal(invalid.headers.get("content-range"), "bytes */11");
  assert.deepEqual(parseSingleRange("bytes=0-0", 1), { start: 0, end: 0 }); assert.equal(parseSingleRange("bytes=0-1,3-4", 10), "invalid");
});

test("file routes reject traversal, NUL, oversized preview, and symlink content", async () => {
  const { root, app } = await fixture({ resources: { limits: { maxTextPreviewBytes: 4 } } });
  writeFileSync(join(root, "large.txt"), "12345"); const outside = temp("pi-host-secret-"); writeFileSync(join(outside, "secret"), "SECRET"); symlinkSync(join(outside, "secret"), join(root, "link"));
  for (const value of [resolve(root, "..", "outside"), `${root}\0bad`, join(root, "link")]) {
    const res = await app.request(`http://localhost/v1/files?op=read&path=${encodeURIComponent(value)}`, { headers: headers() });
    assert.ok([400, 403, 404].includes(res.status), `${value}: ${res.status}`); assert.ok(!(await res.text()).includes("SECRET"));
  }
  const large = await app.request(`http://localhost/v1/files?op=read&path=${encodeURIComponent(join(root, "large.txt"))}`, { headers: headers() }); assert.equal(large.status, 413);
});

test("uploads enforce names, size, conflicts and never follow symlink targets", async () => {
  const { root, app } = await fixture({ resources: { limits: { maxUploadFileBytes: 5, maxUploadTotalBytes: 8 } } });
  const upload = async (files, conflict = "error") => { const form = new FormData(); for (const [name, value] of files) form.append("files", new File([value], name)); return app.request(`http://localhost/v1/files?path=${encodeURIComponent(root)}&conflict=${conflict}`, { method: "POST", headers: headers(), body: form }); };
  let res = await upload([["a.txt", "abc"]]); assert.equal(res.status, 201); assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "abc");
  res = await upload([["a.txt", "new"]]); assert.equal(res.status, 409); assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "abc");
  res = await upload([["a.txt", "new"]], "skip"); assert.equal(res.status, 201); assert.deepEqual((await res.json()).skipped, ["a.txt"]);
  res = await upload([["a.txt", "new"]], "overwrite"); assert.equal(res.status, 201); assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "new");
  res = await upload([["../evil", "x"]]); assert.equal(res.status, 400);
  res = await upload([["big", "123456"]]); assert.equal(res.status, 413);
  const outside = temp("pi-upload-outside-"); const secret = join(outside, "secret"); writeFileSync(secret, "safe"); symlinkSync(secret, join(root, "linked"));
  res = await upload([["linked", "owned"]], "overwrite"); assert.equal(res.status, 409); assert.equal(readFileSync(secret, "utf8"), "safe");
});

test("cwd expansion is local-policy only and LAN cannot self-authorize", async () => {
  const root = temp("pi-root-"); const extra = temp("pi-extra-");
  const localRoots = await createAllowedRootService({ roots: [root], allowLocalExpansion: true });
  const local = createHostApp({ logger: {}, gate, resources: { allowedRoots: localRoots } }).app;
  let res = await local.request("http://localhost/v1/cwd/validate", { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: extra }) });
  assert.equal(res.status, 200); assert.ok(localRoots.roots().includes(await import("node:fs/promises").then(({ realpath }) => realpath(extra))));
  const lanRoots = await createAllowedRootService({ roots: [root], allowLocalExpansion: true });
  const lan = createHostApp({ logger: {}, gate, exposureMode: "lan", resources: { allowedRoots: lanRoots } }).app;
  res = await lan.request("http://127.0.0.1/v1/cwd/validate", { method: "POST", headers: { host: "127.0.0.1", "content-type": "application/json" }, body: JSON.stringify({ cwd: extra }) });
  assert.ok([401, 403].includes(res.status)); // D-020/security policy prevents expansion before the resource service.
});

test("default cwd creation is injected, canonicalized, and fail-closed when unavailable", async () => {
  const root = temp("pi-default-root-"); const project = join(root, "project"); const cwd = join(project, "day", "f"); mkdirSync(cwd, { recursive: true }); const roots = await createAllowedRootService({ roots: [root] });
  let app = createHostApp({ logger: {}, gate, resources: { allowedRoots: roots } }).app;
  let response = await app.request("http://localhost/v1/cwd/default", { method: "POST", headers: headers() }); assert.equal(response.status, 503);
  app = createHostApp({ logger: {}, gate, resources: { allowedRoots: roots, defaultCwdFactory: { create: async () => ({ cwd, projectRoot: project }) } } }).app;
  response = await app.request("http://localhost/v1/cwd/default", { method: "POST", headers: headers() }); assert.equal(response.status, 201); const body = await response.json(); assert.ok(roots.roots().includes(body.cwd)); assert.ok(roots.roots().includes(body.projectRoot));
});

test("file index uses git ignore semantics and fallback walk skips symlinks", async () => {
  const { root, app } = await fixture(); initRepo(root); writeFileSync(join(root, "needle.ts"), "x"); mkdirSync(join(root, "node_modules")); writeFileSync(join(root, "node_modules", "bad.js"), "x");
  const response = await app.request(`http://localhost/v1/file-index?cwd=${encodeURIComponent(root)}&q=needle`, { headers: headers() });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).matches, [{ path: "needle.ts", isDir: false }]);
});

test("file index fallback observes an already-aborted request and leaves no traversal state", async () => {
  const root = temp("pi-index-abort-"); mkdirSync(join(root, "sub")); writeFileSync(join(root, "sub", "a.txt"), "x"); const roots = await createAllowedRootService({ roots: [root] });
  const controller = new AbortController(); controller.abort();
  const app = createHostApp({ logger: {}, gate, resources: { allowedRoots: roots, processRunner: { run: async () => ({ stdout: "", stderr: "not git", exitCode: 1, truncated: false }) } } }).app;
  const response = await app.request(`http://localhost/v1/file-index?cwd=${encodeURIComponent(root)}`, { headers: headers(), signal: controller.signal });
  assert.equal(response.status, 499); const normal = await app.request(`http://localhost/v1/file-index?cwd=${encodeURIComponent(root)}`, { headers: headers() }); assert.equal(normal.status, 200); assert.deepEqual((await normal.json()).files, ["sub/a.txt"]);
});

test("git status/diff are repo-contained and handle untracked patches", async () => {
  const { root, app } = await fixture(); initRepo(root); writeFileSync(join(root, "tracked.txt"), "one\ntwo\n"); writeFileSync(join(root, "new.txt"), "new\n");
  const status = await app.request(`http://localhost/v1/git/status?cwd=${encodeURIComponent(root)}`, { headers: headers() }); const body = await status.json(); assert.equal(body.isGitRepository, true); assert.deepEqual(body.files.map((f) => f.status).sort(), ["modified", "untracked"]);
  const diff = await app.request(`http://localhost/v1/git/diff?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(join(root, "new.txt"))}`, { headers: headers() }); const patch = await diff.json(); assert.equal(patch.supported, true); assert.match(patch.patch, /\+new/);
  const denied = await app.request(`http://localhost/v1/git/diff?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(join(root, "..", "escape"))}`, { headers: headers() }); assert.equal(denied.status, 403);
});

test("worktree deletion fails closed without preflight and force never overrides busy", async () => {
  const root = temp("pi-worktree-repo-"); initRepo(root); const allowedRoots = await createAllowedRootService({ roots: [root] });
  const noPreflight = createHostApp({ logger: {}, gate, resources: { allowedRoots } }).app;
  const create = await noPreflight.request("http://localhost/v1/worktrees", { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: root, branch: "feature-safe" }) }); assert.equal(create.status, 201); const target = (await create.json()).path;
  let removed = await noPreflight.request("http://localhost/v1/worktrees", { method: "DELETE", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: root, path: target, force: true }) }); assert.equal(removed.status, 503);
  const busy = createHostApp({ logger: {}, gate, resources: { allowedRoots, busyPreflight: { check: async () => ({ busy: true, reason: "active" }) } } }).app;
  removed = await busy.request("http://localhost/v1/worktrees", { method: "DELETE", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: root, path: target, force: true }) }); assert.equal(removed.status, 409); assert.equal((await removed.json()).code, "WORKTREE_BUSY");
});

test("worktree dirty check requires force but clean/forced deletion succeeds", async () => {
  const root = temp("pi-worktree-dirty-"); initRepo(root); const allowedRoots = await createAllowedRootService({ roots: [root] }); const preflight = { check: async () => ({ busy: false }) };
  const app = createHostApp({ logger: {}, gate, resources: { allowedRoots, busyPreflight: preflight } }).app;
  let create = await app.request("http://localhost/v1/worktrees", { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: root, branch: "dirty-branch" }) }); const dirtyPath = (await create.json()).path; writeFileSync(join(dirtyPath, "dirty.txt"), "x");
  let remove = await app.request("http://localhost/v1/worktrees", { method: "DELETE", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: root, path: dirtyPath }) }); assert.equal(remove.status, 409); assert.equal((await remove.json()).code, "WORKTREE_DIRTY");
  remove = await app.request("http://localhost/v1/worktrees", { method: "DELETE", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: root, path: dirtyPath, force: true }) }); assert.equal(remove.status, 200);
  create = await app.request("http://localhost/v1/worktrees", { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: root, branch: "clean-branch" }) }); const cleanPath = (await create.json()).path;
  remove = await app.request("http://localhost/v1/worktrees", { method: "DELETE", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: root, path: cleanPath }) }); assert.equal(remove.status, 200);
});

test("worktree creation rejects symlink base and rolls back when root registration fails", async () => {
  const root = temp("pi-worktree-rollback-"); initRepo(root); const outside = temp("pi-worktree-outside-"); const base = `${resolve(root)}-worktrees`; symlinkSync(outside, base, "dir");
  let allowedRoots = await createAllowedRootService({ roots: [root] }); let app = createHostApp({ logger: {}, gate, resources: { allowedRoots } }).app;
  let response = await app.request("http://localhost/v1/worktrees", { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: root, branch: "unsafe-base" }) }); assert.equal(response.status, 409); assert.deepEqual(allowedRoots.roots(), [await import("node:fs/promises").then(({ realpath }) => realpath(root))]);
  rmSync(base); allowedRoots = await createAllowedRootService({ roots: [root], maxRoots: 1 }); app = createHostApp({ logger: {}, gate, resources: { allowedRoots } }).app;
  response = await app.request("http://localhost/v1/worktrees", { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: root, branch: "registration-fails" }) }); assert.equal(response.status, 429);
  assert.ok(!git(root, ["worktree", "list", "--porcelain"]).includes("registration-fails")); assert.throws(() => git(root, ["show-ref", "--verify", "refs/heads/registration-fails"])); assert.ok(!allowedRoots.roots().some((entry) => entry.includes("registration-fails")));
});

test("worktree rollback preserves pre-existing branch and base", async () => {
  const root = temp("pi-worktree-preserve-"); initRepo(root); git(root, ["branch", "existing-branch"]); const base = `${resolve(root)}-worktrees`; mkdirSync(base); writeFileSync(join(base, "keep.txt"), "keep");
  const roots = await createAllowedRootService({ roots: [root], maxRoots: 1 }); const app = createHostApp({ logger: {}, gate, resources: { allowedRoots: roots } }).app;
  const response = await app.request("http://localhost/v1/worktrees", { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: root, branch: "existing-branch" }) }); assert.equal(response.status, 429);
  assert.doesNotThrow(() => git(root, ["show-ref", "--verify", "refs/heads/existing-branch"])); assert.equal(readFileSync(join(base, "keep.txt"), "utf8"), "keep"); assert.ok(!git(root, ["worktree", "list", "--porcelain"]).includes(join(base, "existing-branch")));
});

test("malicious worktree branches are rejected before git argv execution", async () => {
  const { root, app } = await fixture(); initRepo(root);
  for (const branch of ["-c", "../evil", "bad name", "x\nmain", "refs@{1}", "a..b"]) {
    const res = await app.request("http://localhost/v1/worktrees", { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ cwd: root, branch }) }); assert.equal(res.status, 400, branch);
  }
});

test("bounded process runner does not spawn pre-aborted work and distinguishes timeout/abort/exit/output", async () => {
  const runner = createProcessRunner({ allowedCommands: [process.execPath] });
  const marker = join(temp("pi-process-marker-"), "spawned");
  const preAborted = new AbortController(); preAborted.abort();
  await assert.rejects(() => runner.run({ command: process.execPath, args: ["-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'x')`], signal: preAborted.signal }), (e) => e.code === "PROCESS_ABORTED");
  assert.throws(() => readFileSync(marker), (e) => e.code === "ENOENT");
  await assert.rejects(() => runner.run({ command: process.execPath, args: ["-e", "setTimeout(()=>{},1000)"], timeoutMs: 20 }), (e) => e.code === "PROCESS_TIMEOUT");
  await assert.rejects(() => runner.run({ command: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(10000))"], maxOutputBytes: 100 }), (e) => e.code === "PROCESS_OUTPUT_LIMIT");
  const exit = await runner.run({ command: process.execPath, args: ["-e", "process.exit(7)"] }); assert.equal(exit.exitCode, 7);
  const controller = new AbortController(); const pending = runner.run({ command: process.execPath, args: ["-e", "setTimeout(()=>{},1000)"], signal: controller.signal }); controller.abort(); await assert.rejects(() => pending, (e) => e.code === "PROCESS_ABORTED");
});

test("file watch manager reserves atomically and releases on creation failure, abort, cancel, and closeAll", async () => {
  const root = temp("pi-watch-"); const file = join(root, "a.txt"); writeFileSync(file, "a"); const manager = createFileWatchManager(1);
  const first = manager.open(file); assert.equal(manager.reservedCount(), 1);
  assert.throws(() => manager.open(file), (e) => e.code === "WATCH_LIMIT");
  const reader = first.body.getReader(); await reader.read(); assert.equal(manager.reservedCount(), 0); assert.equal(manager.activeCount(), 1);
  await reader.cancel(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(manager.activeCount(), 0);

  const missing = manager.open(join(root, "missing")); await assert.rejects(() => missing.body.getReader().read()); await new Promise((resolve) => setImmediate(resolve)); assert.equal(manager.reservedCount(), 0);
  const controller = new AbortController(); const aborted = manager.open(file, controller.signal); controller.abort(); const abortedReader = aborted.body.getReader(); assert.equal((await abortedReader.read()).done, true); assert.equal(manager.reservedCount(), 0); assert.equal(manager.activeCount(), 0);
  const closing = manager.open(file); await closing.body.getReader().read(); manager.closeAll(); assert.equal(manager.activeCount(), 0); assert.equal(manager.reservedCount(), 0);
});

test("resource APIs remain protected by gate and unknown APIs stay JSON 404", async () => {
  const root = temp("pi-gated-"); const allowedRoots = await createAllowedRootService({ roots: [root] }); const app = createHostApp({ logger: {}, gate: { config: { read: () => ({ status: "enabled", password: "secret", source: "test" }) } }, resources: { allowedRoots } }).app;
  const denied = await app.request(`http://localhost/v1/files?path=${encodeURIComponent(root)}`, { headers: headers() }); assert.equal(denied.status, 401);
  const missing = await app.request("http://localhost/v1/resource-nope", { headers: headers({ cookie: "bad" }) }); assert.equal(missing.status, 401); assert.match(missing.headers.get("content-type") ?? "", /json/);
});

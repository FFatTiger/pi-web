// scripts/run-workspaces.test.mjs
// Tests for the cross-platform `npm run <script> --workspaces --if-present`
// wrapper. Uses only Node builtins and temporary fixture directories, so it
// runs with no installed dependencies and never pollutes the repository.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildSpawnArgs,
  discoverWorkspaces,
  expandPattern,
  main,
  readWorkspaceConfig,
  resolveNpmInvocation,
  runWorkspaces,
} from "./run-workspaces.mjs";

const WRAPPER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "run-workspaces.mjs");
const WRAPPER_URL = pathToFileURL(WRAPPER_PATH).href;

function makeRoot({ workspaces, noManifest = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rws-root-"));
  if (!noManifest) {
    const manifest = { name: "fixture-root", version: "0.0.0" };
    if (workspaces !== undefined) manifest.workspaces = workspaces;
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  }
  return dir;
}

function addWorkspace(root, name, manifest = {}) {
  const wdir = join(root, "packages", name);
  mkdirSync(wdir, { recursive: true });
  writeFileSync(
    join(wdir, "package.json"),
    JSON.stringify({ name, version: "0.0.0", private: true, ...manifest }),
  );
  return wdir;
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// Run an async fn with console.log captured into `logs`. Returns fn's value.
async function withLogCapture(logs, fn) {
  const original = console.log;
  console.log = (msg) => logs.push(String(msg));
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

// Run an async fn with console.error captured into `logs`. Returns fn's value.
async function withErrorCapture(logs, fn) {
  const original = console.error;
  console.error = (msg) => logs.push(String(msg));
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

test("discovers zero workspaces when packages/* matches nothing", (t) => {
  const root = makeRoot({ workspaces: ["packages/*"] });
  t.after(() => cleanup(root));
  assert.deepEqual(discoverWorkspaces(root), []);
  assert.deepEqual(readWorkspaceConfig(root), { patterns: ["packages/*"], dirs: [] });
});

test("discovers only directories that contain a package.json", (t) => {
  const root = makeRoot({ workspaces: ["packages/*"] });
  t.after(() => cleanup(root));
  addWorkspace(root, "a");
  mkdirSync(join(root, "packages", "b"), { recursive: true }); // no manifest
  addWorkspace(root, "c");
  assert.deepEqual(
    discoverWorkspaces(root).map((d) => d.replace(root, "")),
    ["/packages/a", "/packages/c"],
  );
});

test("supports recursive ** and literal workspace patterns", (t) => {
  const root = makeRoot({ workspaces: ["packages/**", "tools/meta"] });
  t.after(() => cleanup(root));
  addWorkspace(root, "a");
  const nested = join(root, "packages", "nested", "deep");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "package.json"), JSON.stringify({ name: "deep" }));
  const meta = join(root, "tools", "meta");
  mkdirSync(meta, { recursive: true });
  writeFileSync(join(meta, "package.json"), JSON.stringify({ name: "meta" }));
  assert.deepEqual(
    discoverWorkspaces(root).map((d) => d.replace(root, "")),
    ["/packages/a", "/packages/nested/deep", "/tools/meta"],
  );
});

test("returns no workspaces when the root manifest has no workspaces field", (t) => {
  const root = makeRoot();
  t.after(() => cleanup(root));
  assert.deepEqual(readWorkspaceConfig(root), { patterns: [], dirs: [] });
});

test("throws a clear error for an invalid workspace manifest", (t) => {
  const root = makeRoot({ workspaces: ["packages/*"] });
  t.after(() => cleanup(root));
  const wdir = addWorkspace(root, "a");
  writeFileSync(join(wdir, "package.json"), "{ not json");
  assert.throws(
    () => discoverWorkspaces(root),
    /invalid workspace manifest at .*package\.json/,
  );
});

test("throws a clear error for a missing literal workspace path", (t) => {
  const root = makeRoot({ workspaces: ["packages/missing"] });
  t.after(() => cleanup(root));
  assert.throws(
    () => discoverWorkspaces(root),
    /workspace path from root package\.json not found: .*packages[\\/]missing/,
  );
});

test("throws for a non-array workspaces field", (t) => {
  const root = makeRoot({ workspaces: "packages/*" });
  t.after(() => cleanup(root));
  assert.throws(() => discoverWorkspaces(root), /"workspaces" must be an array/);
});

test("throws for a missing root package.json", (t) => {
  const root = makeRoot({ noManifest: true });
  t.after(() => cleanup(root));
  assert.throws(() => discoverWorkspaces(root), /cannot read root package\.json/);
});

test("expandPattern handles a literal dir without a manifest", (t) => {
  const root = makeRoot({ workspaces: ["packages/*"] });
  t.after(() => cleanup(root));
  mkdirSync(join(root, "packages", "empty"), { recursive: true });
  assert.deepEqual(expandPattern(root, "packages/*"), []);
});

// ---------------------------------------------------------------------------
// npm invocation resolution and spawn args
// ---------------------------------------------------------------------------

test("resolveNpmInvocation prefers npm_execpath from the invoking npm", (t) => {
  const root = makeRoot();
  t.after(() => cleanup(root));
  const fakeCli = join(root, "npm-cli.js");
  writeFileSync(fakeCli, "");
  const inv = resolveNpmInvocation({
    execPath: process.execPath,
    env: { npm_execpath: fakeCli },
  });
  assert.equal(inv.command, process.execPath);
  assert.deepEqual(inv.args, [fakeCli]);
  assert.equal(inv.shell, false);
});

test("resolveNpmInvocation uses the npm sibling of the node binary", (t) => {
  const root = makeRoot();
  t.after(() => cleanup(root));
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "npm"), "");
  const inv = resolveNpmInvocation({
    platform: "darwin",
    execPath: join(bin, "node"),
    env: {},
  });
  assert.equal(inv.command, join(bin, "npm"));
  assert.deepEqual(inv.args, []);
  assert.equal(inv.shell, false);
});

test("resolveNpmInvocation falls back to npm.cmd on Windows and npm elsewhere", () => {
  const win = resolveNpmInvocation({ platform: "win32", execPath: join("C:\\", "nodejs", "node.exe"), env: {} });
  assert.equal(win.command, "npm.cmd");
  assert.equal(win.shell, true);
  const posix = resolveNpmInvocation({ platform: "linux", execPath: "/usr/bin/node", env: {} });
  assert.equal(posix.command, "npm");
  assert.equal(posix.shell, false);
});

test("buildSpawnArgs always produces npm run <script> --workspaces --if-present", () => {
  const args = buildSpawnArgs("typecheck", { command: "npm", args: [], shell: false });
  assert.equal(args.command, "npm");
  assert.deepEqual(args.args, ["run", "typecheck", "--workspaces", "--if-present"]);
  const withCli = buildSpawnArgs("build", { command: process.execPath, args: ["/x/npm-cli.js"], shell: false });
  assert.deepEqual(withCli.args, ["/x/npm-cli.js", "run", "build", "--workspaces", "--if-present"]);
});

// ---------------------------------------------------------------------------
// runWorkspaces behavior
// ---------------------------------------------------------------------------

test("zero workspaces: exits 0 with a short note and never spawns", async (t) => {
  const root = makeRoot({ workspaces: ["packages/*"] });
  t.after(() => cleanup(root));
  const logs = [];
  let spawned = false;
  const code = await withLogCapture(logs, () =>
    runWorkspaces("build", {
      rootDir: root,
      spawnImpl: () => {
        spawned = true;
        throw new Error("must not spawn");
      },
    }),
  );
  assert.equal(code, 0);
  assert.equal(spawned, false);
  assert.ok(logs.length > 0, "expected a log line");
  assert.match(logs[0], /no workspace package\.json found for root workspaces \(packages\/\*\)/);
});

test("spawns with cwd at the root and inherited stdio, then propagates the child exit code", async (t) => {
  const root = makeRoot({ workspaces: ["packages/*"] });
  addWorkspace(root, "a");
  t.after(() => cleanup(root));
  let captured;
  const fakeChild = new EventEmitter();
  const pending = runWorkspaces("typecheck", {
    rootDir: root,
    npmInvocation: { command: "npm", args: [], shell: false },
    spawnImpl: (command, args, opts) => {
      captured = { command, args, opts };
      return fakeChild;
    },
  });
  assert.ok(captured, "spawnImpl was called");
  assert.equal(captured.command, "npm");
  assert.deepEqual(captured.args, ["run", "typecheck", "--workspaces", "--if-present"]);
  assert.equal(captured.opts.cwd, root);
  assert.equal(captured.opts.stdio, "inherit");
  fakeChild.emit("exit", 0, null);
  assert.equal(await pending, 0);
});

test("propagates a non-zero child exit code", async (t) => {
  const root = makeRoot({ workspaces: ["packages/*"] });
  addWorkspace(root, "a");
  t.after(() => cleanup(root));
  const fakeChild = new EventEmitter();
  const pending = runWorkspaces("build", {
    rootDir: root,
    npmInvocation: { command: "npm", args: [], shell: false },
    spawnImpl: () => fakeChild,
  });
  fakeChild.emit("exit", 42, null);
  assert.equal(await pending, 42);
});

test("resolves 1 and reports when the child fails to start", async (t) => {
  const root = makeRoot({ workspaces: ["packages/*"] });
  addWorkspace(root, "a");
  t.after(() => cleanup(root));
  const errors = [];
  const fakeChild = new EventEmitter();
  const code = await withErrorCapture(errors, async () => {
    const pending = runWorkspaces("test", {
      rootDir: root,
      npmInvocation: { command: "npm", args: [], shell: false },
      spawnImpl: () => fakeChild,
    });
    fakeChild.emit("error", new Error("ENOENT boom"));
    return await pending;
  });
  assert.equal(code, 1);
  assert.ok(errors.some((line) => /failed to start npm/.test(line)));
});

test("end-to-end: runs the real npm invocation with a fake npm child script", async (t) => {
  const root = makeRoot({ workspaces: ["packages/*"] });
  addWorkspace(root, "a");
  t.after(() => cleanup(root));
  const out = join(root, "out.jsonl");
  const fakeNpm = join(root, "fake-npm.mjs");
  writeFileSync(
    fakeNpm,
    `import { appendFileSync } from "node:fs";\n` +
      `import { cwd } from "node:process";\n` +
      `appendFileSync(process.env.RWS_OUT, JSON.stringify({ args: process.argv.slice(2), cwd: cwd() }) + "\\n");\n` +
      `process.exit(Number(process.env.RWS_CODE ?? "0"));\n`,
  );
  const code = await runWorkspaces("typecheck", {
    rootDir: root,
    npmInvocation: { command: process.execPath, args: [fakeNpm], shell: false },
    env: { ...process.env, RWS_OUT: out, RWS_CODE: "0" },
  });
  assert.equal(code, 0);
  const recorded = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(recorded.args, ["run", "typecheck", "--workspaces", "--if-present"]);
  assert.equal(recorded.cwd, realpathSync(root));
});

test("end-to-end: child failure exit code is propagated from the real spawn", async (t) => {
  const root = makeRoot({ workspaces: ["packages/*"] });
  addWorkspace(root, "a");
  t.after(() => cleanup(root));
  const out = join(root, "out.jsonl");
  const fakeNpm = join(root, "fake-npm.mjs");
  writeFileSync(
    fakeNpm,
    `import { appendFileSync } from "node:fs";\n` +
      `appendFileSync(process.env.RWS_OUT, "ran\\n");\n` +
      `process.exit(Number(process.env.RWS_CODE ?? "0"));\n`,
  );
  const code = await runWorkspaces("test", {
    rootDir: root,
    npmInvocation: { command: process.execPath, args: [fakeNpm], shell: false },
    env: { ...process.env, RWS_OUT: out, RWS_CODE: "42" },
  });
  assert.equal(code, 42);
  assert.ok(readFileSync(out, "utf8").includes("ran"));
});

test("re-raises a child termination signal on itself", { skip: process.platform === "win32" }, async (t) => {
  const root = makeRoot({ workspaces: ["packages/*"] });
  addWorkspace(root, "a");
  t.after(() => cleanup(root));
  const killer = join(root, "killer.mjs");
  writeFileSync(killer, `process.kill(process.pid, "SIGTERM");\n`);
  const driver = join(root, "driver.mjs");
  writeFileSync(
    driver,
    `import { runWorkspaces } from ${JSON.stringify(WRAPPER_URL)};\n` +
      `const code = await runWorkspaces("test", {\n` +
      `  rootDir: ${JSON.stringify(root)},\n` +
      `  npmInvocation: { command: process.execPath, args: [${JSON.stringify(killer)}], shell: false },\n` +
      `});\n` +
      `process.exit(code);\n`,
  );
  const result = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [driver], { stdio: "ignore" });
    child.on("close", (code, signal) => resolvePromise({ code, signal }));
  });
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.code, null);
});

// ---------------------------------------------------------------------------
// main / CLI
// ---------------------------------------------------------------------------

test("main: missing script name is a usage error (exit 2)", async () => {
  const errors = [];
  const code = await withErrorCapture(errors, () =>
    main([], {
      runWorkspaces: async () => {
        throw new Error("must not run");
      },
    }),
  );
  assert.equal(code, 2);
  assert.ok(errors.some((line) => /usage: node scripts\/run-workspaces\.mjs/.test(line)));
});

test("main: forwards the runWorkspaces exit code", async () => {
  const code = await main(["build"], { runWorkspaces: async () => 7 });
  assert.equal(code, 7);
});

test("main: turns a thrown error into exit 1 with a message", async () => {
  const errors = [];
  const code = await withErrorCapture(errors, () =>
    main(["typecheck"], {
      runWorkspaces: async () => {
        throw new Error("boom");
      },
    }),
  );
  assert.equal(code, 1);
  assert.ok(errors.some((line) => /\[run-workspaces\] boom/.test(line)));
});

test("end-to-end: CLI exits 0 with a note when there are no workspaces", async (t) => {
  // Run a copy of the wrapper from a fixture root so ROOT_DIR resolves to the
  // fixture (hermetic, no dependence on the real repository layout).
  const root = makeRoot({ workspaces: ["packages/*"] });
  t.after(() => cleanup(root));
  mkdirSync(join(root, "scripts"), { recursive: true });
  const copy = join(root, "scripts", "run-workspaces.mjs");
  writeFileSync(copy, readFileSync(WRAPPER_PATH, "utf8"));
  const result = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [copy, "typecheck"], { cwd: root });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("close", (code, signal) => resolvePromise({ code, signal, stdout }));
  });
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /no workspace package\.json found/);
});

test("end-to-end: CLI usage error exits 2", async (t) => {
  const root = makeRoot({ workspaces: ["packages/*"] });
  t.after(() => cleanup(root));
  mkdirSync(join(root, "scripts"), { recursive: true });
  const copy = join(root, "scripts", "run-workspaces.mjs");
  writeFileSync(copy, readFileSync(WRAPPER_PATH, "utf8"));
  const result = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [copy], { cwd: root });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolvePromise({ code, stderr }));
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage: node scripts\/run-workspaces\.mjs/);
});

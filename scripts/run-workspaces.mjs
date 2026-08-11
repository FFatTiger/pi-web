// scripts/run-workspaces.mjs
// Cross-platform runner for `npm run <script> --workspaces --if-present`.
//
// Why this exists: with zero actual workspace package.json files, npm itself
// fails with "No workspaces found!" and exit code 1, which would break the
// root `workspaces:*` scripts until the first real package lands. This wrapper
// instead:
//
//   - reads the root package.json `workspaces` field (currently ["packages/*"]);
//   - if no workspace directory actually contains a package.json, prints a short
//     note and exits 0;
//   - otherwise spawns the npm paired with the current Node and runs
//     `npm run <script> --workspaces --if-present`, inheriting stdio, exit code,
//     and (via default foreground-process-group handling plus signal re-raise)
//     termination signals. The root package's own script of the same name is
//     never executed: `--workspaces` restricts npm to workspace directories.
//
// Invalid root/workspace manifests and missing literal workspace paths fail
// with a clear error message instead of npm's terse output.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Expand one workspace pattern to directories that contain a package.json. */
export function expandPattern(rootDir, pattern) {
  if (!pattern || pattern.startsWith("!")) {
    // Negation patterns are not supported by npm workspaces either; ignore.
    return [];
  }
  if (pattern.endsWith("/**")) {
    // Recursive: the base directory plus every nested directory with a manifest.
    const base = join(rootDir, pattern.slice(0, -3));
    const out = [];
    if (existsSync(join(base, "package.json"))) out.push(base);
    const walk = (dir) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // missing/unreadable directory: glob simply matched nothing
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
        const childDir = join(dir, entry.name);
        if (existsSync(join(childDir, "package.json"))) out.push(childDir);
        walk(childDir);
      }
    };
    walk(base);
    return out;
  }
  if (pattern.endsWith("/*")) {
    // Immediate children (the packages/* form).
    const base = join(rootDir, pattern.slice(0, -2));
    let entries;
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      return []; // glob matched nothing (e.g. no packages/ directory yet)
    }
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(base, entry.name))
      .filter((dir) => existsSync(join(dir, "package.json")));
  }
  // Literal path: must exist, otherwise npm would fail too — say so clearly.
  const literalDir = join(rootDir, pattern);
  if (!existsSync(literalDir)) {
    throw new Error(`workspace path from root package.json not found: ${literalDir}`);
  }
  return existsSync(join(literalDir, "package.json")) ? [literalDir] : [];
}

/**
 * Read the root manifest and return { patterns, dirs } where dirs are the
 * workspace directories that contain a parseable package.json.
 */
export function readWorkspaceConfig(rootDir = ROOT_DIR) {
  const manifestPath = join(rootDir, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(`cannot read root package.json at ${manifestPath}: ${err.message}`);
  }
  const patterns = manifest.workspaces;
  if (patterns === undefined) return { patterns: [], dirs: [] };
  if (!Array.isArray(patterns)) {
    throw new Error(
      `root package.json "workspaces" must be an array, got ${JSON.stringify(patterns)}`,
    );
  }
  const dirs = [];
  for (const pattern of patterns) {
    for (const dir of expandPattern(rootDir, pattern)) {
      if (!dirs.includes(dir)) dirs.push(dir);
    }
  }
  for (const dir of dirs) {
    const manifestFile = join(dir, "package.json");
    try {
      JSON.parse(readFileSync(manifestFile, "utf8"));
    } catch (err) {
      throw new Error(`invalid workspace manifest at ${manifestFile}: ${err.message}`);
    }
  }
  return { patterns, dirs };
}

/** Workspace directories that actually contain a parseable package.json. */
export function discoverWorkspaces(rootDir = ROOT_DIR) {
  return readWorkspaceConfig(rootDir).dirs;
}

/**
 * The npm executable paired with the current Node runtime, as a spawn
 * invocation { command, args, shell }:
 *
 *   1. npm_execpath (set by npm while running our script) → run that exact
 *      npm-cli.js with the current Node, so the same npm version is reused;
 *   2. an npm/npm.cmd shipped next to the running node binary;
 *   3. bare `npm` (or `npm.cmd` on Windows) resolved via PATH.
 */
export function resolveNpmInvocation({
  platform = process.platform,
  execPath = process.execPath,
  env = process.env,
} = {}) {
  const npmExecPath = env.npm_execpath;
  if (npmExecPath && /npm-cli\.js$/i.test(npmExecPath) && existsSync(npmExecPath)) {
    return { command: execPath, args: [npmExecPath], shell: false };
  }
  const sibling = join(dirname(execPath), platform === "win32" ? "npm.cmd" : "npm");
  if (existsSync(sibling)) {
    return { command: sibling, args: [], shell: platform === "win32" };
  }
  return {
    command: platform === "win32" ? "npm.cmd" : "npm",
    args: [],
    shell: platform === "win32",
  };
}

/** Spawn arguments for `npm run <script> --workspaces --if-present`. */
export function buildSpawnArgs(scriptName, npmInvocation) {
  return {
    command: npmInvocation.command,
    args: [...npmInvocation.args, "run", scriptName, "--workspaces", "--if-present"],
    shell: npmInvocation.shell ?? false,
  };
}

/**
 * Run `<script>` in every workspace that has it. Resolves with the child exit
 * code; never runs the root package's own script of the same name.
 */
export async function runWorkspaces(scriptName, options = {}) {
  const rootDir = options.rootDir ?? ROOT_DIR;
  const { patterns, dirs } = readWorkspaceConfig(rootDir);
  if (dirs.length === 0) {
    console.log(
      `[run-workspaces] no workspace package.json found for root workspaces ` +
        `(${patterns.join(", ") || "none"}); nothing to run.`,
    );
    return 0;
  }
  const npmInvocation = options.npmInvocation ?? resolveNpmInvocation();
  const { command, args, shell } = buildSpawnArgs(scriptName, npmInvocation);
  const spawnImpl = options.spawnImpl ?? spawn;
  return await new Promise((resolvePromise) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        cwd: rootDir,
        stdio: options.stdio ?? "inherit",
        env: options.env ?? process.env,
        shell,
      });
    } catch (err) {
      console.error(`[run-workspaces] failed to start ${command}: ${err.message}`);
      resolvePromise(1);
      return;
    }
    child.on("error", (err) => {
      console.error(`[run-workspaces] failed to start ${command}: ${err.message}`);
      resolvePromise(1);
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        // Re-raise on ourselves so the wrapper is reported as killed by the
        // same signal the child died from (e.g. a build tool sending SIGTERM).
        process.kill(process.pid, signal);
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

/** CLI entry: resolves with the process exit code. */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const scriptName = argv[0];
  if (!scriptName) {
    console.error("usage: node scripts/run-workspaces.mjs <script>");
    console.error("       node scripts/run-workspaces.mjs build|typecheck|test");
    return 2;
  }
  const run = deps.runWorkspaces ?? runWorkspaces;
  try {
    return await run(scriptName, deps.options ?? {});
  } catch (err) {
    console.error(`[run-workspaces] ${err.message}`);
    return 1;
  }
}

// Run only when executed directly, not when imported (e.g. by the test file).
// Compare realpaths: argv[1] keeps the path as passed while import.meta.url is
// canonicalized (e.g. /var -> /private/var on macOS), so a plain string
// comparison would miss the main-module case for symlinked paths.
if (process.argv[1]) {
  try {
    const isMain =
      realpathSync(resolve(process.argv[1])) ===
      realpathSync(fileURLToPath(import.meta.url));
    if (isMain) {
      main().then((code) => {
        process.exitCode = code;
      });
    }
  } catch {
    // Not the main module; ignore.
  }
}

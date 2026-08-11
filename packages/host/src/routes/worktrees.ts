import { dirname, join, resolve } from "node:path";
import { lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import type { Context, Hono } from "hono";
import type { HostEnv } from "../env.js";
import { HttpError } from "../errors.js";
import type { AllowedRootService } from "../resources/allowed-roots.js";
import { createProcessRunner, runChecked, type ProcessRunner } from "../resources/process-runner.js";
import type { ResourceLimits, WorktreeBusyPreflight } from "../resources/types.js";
import { readJsonObject } from "../resources/request-body.js";

interface WorktreeDeps { roots: AllowedRootService; runner?: ProcessRunner; busyPreflight?: WorktreeBusyPreflight; limits?: ResourceLimits }
interface Worktree { path: string; branch: string | null; isMain: boolean }

async function json(c: Context<HostEnv>): Promise<Record<string, unknown>> {
  return readJsonObject(c);
}

function safeBranch(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 255 || value.trim() !== value || value.startsWith("-") || /[\0\r\n~^:?*[\\]/.test(value) || value.includes("..") || value.endsWith(".") || value.endsWith("/") || value.includes("//") || value.includes("@{")) {
    throw new HttpError(400, "INVALID_BRANCH", "Invalid branch name");
  }
  return value;
}

async function repoRoot(runner: ProcessRunner, cwd: string, max: number): Promise<string> {
  const common = (await runChecked(runner, { command: "git", args: ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], maxOutputBytes: max })).trim();
  return realpath(dirname(common));
}

async function list(runner: ProcessRunner, cwd: string, max: number): Promise<Worktree[]> {
  const out = await runChecked(runner, { command: "git", args: ["-C", cwd, "worktree", "list", "--porcelain", "-z"], maxOutputBytes: max });
  const records = out.split("\0").filter(Boolean);
  const result: Worktree[] = [];
  let current: { path?: string; branch?: string | null; prunable?: boolean } = {};
  const flush = () => { if (current.path && !current.prunable) result.push({ path: current.path, branch: current.branch ?? null, isMain: result.length === 0 }); current = {}; };
  for (const record of records) {
    for (const line of record.split("\n")) {
      if (line.startsWith("worktree ")) { flush(); current.path = line.slice(9); }
      else if (line.startsWith("branch ")) current.branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "detached") current.branch = null;
      else if (line.startsWith("prunable")) current.prunable = true;
    }
  }
  flush();
  const existing: Worktree[] = [];
  for (const item of result) { try { if ((await stat(item.path)).isDirectory()) existing.push({ ...item, path: await realpath(item.path) }); } catch { /* stale */ } }
  return existing;
}

function dirName(branch: string): string {
  const value = branch.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!value) throw new HttpError(400, "INVALID_BRANCH", "Branch cannot form a safe directory name");
  return value.slice(0, 120);
}

export function registerWorktreeRoutes(app: Hono<HostEnv>, deps: WorktreeDeps): void {
  const runner = deps.runner ?? createProcessRunner();
  const max = deps.limits?.processOutputBytes ?? 8 * 1024 * 1024;

  app.get("/v1/worktrees", async (c) => {
    const cwd = c.req.query("cwd"); if (!cwd) throw new HttpError(400, "CWD_REQUIRED", "cwd is required");
    const authorized = await deps.roots.authorizeExisting(cwd, "directory");
    const root = await repoRoot(runner, authorized.canonicalPath, max).catch(() => null);
    if (!root) return c.json({ projectRoot: authorized.canonicalPath, isGit: false, isTopLevel: false, worktrees: [] });
    await deps.roots.authorizeExisting(root, "directory");
    const worktrees = await list(runner, authorized.canonicalPath, max);
    for (const worktree of worktrees) await deps.roots.addVerifiedRoot(worktree.path);
    return c.json({ projectRoot: root, isGit: true, isTopLevel: worktrees.some((item) => item.path === authorized.canonicalPath), worktrees });
  });

  app.post("/v1/worktrees", async (c) => {
    const body = await json(c); if (typeof body.cwd !== "string") throw new HttpError(400, "CWD_REQUIRED", "cwd is required");
    const branch = safeBranch(body.branch); const authorized = await deps.roots.authorizeExisting(body.cwd, "directory");
    const root = await repoRoot(runner, authorized.canonicalPath, max); await deps.roots.authorizeExisting(root, "directory");
    const base = `${resolve(root)}-worktrees`;
    let baseCanonical: string;
    let createdBase = false;
    try {
      const baseInfo = await lstat(base);
      if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) {
        throw new HttpError(409, "UNSAFE_WORKTREE_BASE", "Worktree base must be a real directory, not a symlink");
      }
      baseCanonical = await realpath(base);
      if (baseCanonical !== resolve(base)) throw new HttpError(409, "UNSAFE_WORKTREE_BASE", "Worktree base changed identity");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(base, { recursive: false });
      createdBase = true;
      baseCanonical = await realpath(base);
    }
    const target = join(baseCanonical, dirName(branch));
    try { await stat(target); throw new HttpError(409, "WORKTREE_EXISTS", "Worktree directory already exists"); } catch (error) { if (error instanceof HttpError) throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const branchExists = (await runner.run({ command: "git", args: ["-C", root, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], maxOutputBytes: max })).exitCode === 0;
    await runChecked(runner, { command: "git", args: ["-C", root, "worktree", "add", ...(branchExists ? [] : ["-b", branch]), "--", target, ...(branchExists ? [branch] : [])], maxOutputBytes: max });
    let registered: string | undefined;
    try {
      const targetInfo = await lstat(target);
      if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) throw new HttpError(409, "UNSAFE_WORKTREE_TARGET", "Git created an unsafe worktree target");
      if (await realpath(base) !== baseCanonical) throw new HttpError(409, "UNSAFE_WORKTREE_BASE", "Worktree base was replaced during creation");
      const canonical = await realpath(target);
      if (dirname(canonical) !== baseCanonical) throw new HttpError(409, "UNSAFE_WORKTREE_TARGET", "Worktree target escaped its verified base");
      const verified = await list(runner, root, max);
      if (!verified.some((item) => item.path === canonical && !item.isMain)) throw new HttpError(409, "WORKTREE_VERIFY_FAILED", "Git did not report the created worktree");
      registered = await deps.roots.addVerifiedRoot(canonical);
      return c.json({ path: registered, branch }, 201);
    } catch (error) {
      if (registered) deps.roots.removeVerifiedRoot(registered);
      await runner.run({ command: "git", args: ["-C", root, "worktree", "remove", "--force", "--", target], maxOutputBytes: max }).catch(() => undefined);
      await runner.run({ command: "git", args: ["-C", root, "worktree", "prune"], maxOutputBytes: max }).catch(() => undefined);
      if (!branchExists) {
        await runner.run({ command: "git", args: ["-C", root, "branch", "-D", "--", branch], maxOutputBytes: max }).catch(() => undefined);
      }
      if (createdBase) await rm(baseCanonical, { recursive: false, force: true }).catch(() => undefined);
      throw error;
    }
  });

  app.delete("/v1/worktrees", async (c) => {
    const body = await json(c); if (typeof body.cwd !== "string" || typeof body.path !== "string") throw new HttpError(400, "WORKTREE_INPUT_REQUIRED", "cwd and path are required");
    const authorized = await deps.roots.authorizeExisting(body.cwd, "directory"); const target = await realpath(body.path).catch(() => { throw new HttpError(404, "WORKTREE_NOT_FOUND", "Worktree not found"); });
    const worktrees = await list(runner, authorized.canonicalPath, max); const candidate = worktrees.find((item) => item.path === target);
    if (!candidate) throw new HttpError(403, "NOT_PROJECT_WORKTREE", "Path is not a worktree of this repository");
    if (candidate.isMain) throw new HttpError(409, "MAIN_WORKTREE", "Cannot remove the main worktree");
    if (!deps.busyPreflight) throw new HttpError(503, "BUSY_PREFLIGHT_UNAVAILABLE", "Cannot safely remove a worktree while busy preflight is unavailable");
    const busy = await deps.busyPreflight.check(target); if (busy.busy) throw new HttpError(409, "WORKTREE_BUSY", busy.reason ?? "Worktree has an active Agent session");
    const force = body.force === true;
    if (!force) {
      const status = await runChecked(runner, { command: "git", args: ["-C", target, "status", "--porcelain=v1", "--untracked-files=all"], maxOutputBytes: max });
      if (status.length > 0) throw new HttpError(409, "WORKTREE_DIRTY", "Worktree contains modified or untracked files");
    }
    await runChecked(runner, { command: "git", args: ["-C", authorized.canonicalPath, "worktree", "remove", ...(force ? ["--force"] : []), "--", target], maxOutputBytes: max });
    deps.roots.removeVerifiedRoot(target);
    return c.json({ success: true });
  });
}

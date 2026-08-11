import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { HttpError } from "../errors.js";
import type { HostMode } from "../types.js";
import { AsyncMutex } from "./mutex.js";

export interface AllowedRootPolicy {
  roots: readonly string[];
  allowLocalExpansion?: boolean;
  allowLanExpansion?: boolean;
  maxRoots?: number;
}
export interface AuthorizedPath { requestedPath: string; canonicalPath: string; root: string }
export interface RootExpansionResult { paths: readonly string[]; added: readonly string[] }
export interface RootExpansionPlan { readonly paths: readonly string[]; commit(): Promise<RootExpansionResult> }
export interface AllowedRootService {
  roots(): readonly string[];
  isAuthorized(target: string, kind?: "any" | "file" | "directory"): Promise<boolean>;
  authorizeExisting(target: string, kind?: "any" | "file" | "directory"): Promise<AuthorizedPath>;
  authorizeChild(parent: string, name: string): Promise<AuthorizedPath>;
  prepareExpansion(targets: readonly string[], mode: HostMode): Promise<RootExpansionPlan>;
  expandRoots(targets: readonly string[], mode: HostMode): Promise<RootExpansionResult>;
}
interface RootIdentity { dev: number; ino: number }
interface RootRecord {
  identity: RootIdentity;
  durable: boolean;
  trustedOwners: Set<string>;
}
interface RootState {
  records: Map<string, RootRecord>;
  maxRoots: number;
  policy: AllowedRootPolicy;
  mutation: AsyncMutex;
}
export interface TrustedCreatedRootReceipt {
  canonicalPath: string;
  added: boolean;
  rollback(): Promise<void>;
}
const states = new WeakMap<AllowedRootService, RootState>();

function isWithin(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}
function validateAbsolutePath(value: string): string {
  if (!value || value.includes("\0")) throw new HttpError(400, "INVALID_PATH", "Path is required and must not contain NUL bytes");
  if (!isAbsolute(value)) throw new HttpError(400, "INVALID_PATH", "Path must be absolute");
  return resolve(value);
}
async function canonicalDirectoryWithIdentity(value: string): Promise<{ canonical: string; identity: RootIdentity }> {
  const normalized = validateAbsolutePath(value);
  let canonical: string;
  try { canonical = await realpath(normalized); }
  catch { throw new HttpError(404, "PATH_NOT_FOUND", "Directory not found"); }
  const info = await lstat(canonical);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new HttpError(400, "NOT_DIRECTORY", "Path is not a real directory");
  return { canonical, identity: { dev: info.dev, ino: info.ino } };
}
async function identityStillMatches(path: string, expected: RootIdentity): Promise<boolean> {
  try {
    if (await realpath(path) !== path) return false;
    const current = await lstat(path);
    return current.isDirectory() && !current.isSymbolicLink() && current.dev === expected.dev && current.ino === expected.ino;
  } catch { return false; }
}
function validateChildName(name: string): void {
  if (!name || name === "." || name === ".." || name.includes("\0") || name.includes("/") || name.includes("\\")) throw new HttpError(400, "INVALID_FILE_NAME", "File name must be a single safe path segment");
}
function stateFor(service: AllowedRootService): RootState {
  const state = states.get(service);
  if (!state) throw new Error("Unknown AllowedRootService instance");
  return state;
}
function matchingRoot(state: RootState, canonical: string): string | null {
  let winner: string | null = null;
  for (const root of state.records.keys()) if (isWithin(root, canonical) && (!winner || root.length > winner.length)) winner = root;
  return winner;
}
async function verifyRecord(path: string, record: RootRecord): Promise<void> {
  if (!(await identityStillMatches(path, record.identity))) throw new HttpError(403, "ROOT_REPLACED", "Allowed root was replaced after authorization");
}

/** Internal-only: Worktree routes call this while holding repo lock (repo→roots). */
export async function registerTrustedCreatedRoot(service: AllowedRootService, target: string): Promise<TrustedCreatedRootReceipt> {
  const candidate = await canonicalDirectoryWithIdentity(target);
  const state = stateFor(service);
  const owner = randomUUID();
  return state.mutation.runExclusive(async () => {
    if (!(await identityStillMatches(candidate.canonical, candidate.identity))) throw new HttpError(409, "ROOT_IDENTITY_CHANGED", "Created root changed identity before registration");
    const existing = state.records.get(candidate.canonical);
    if (existing) {
      await verifyRecord(candidate.canonical, existing);
      existing.trustedOwners.add(owner);
    } else {
      if (state.records.size >= state.maxRoots) throw new HttpError(429, "ROOT_LIMIT", "Allowed-root limit reached");
      state.records.set(candidate.canonical, { identity: candidate.identity, durable: false, trustedOwners: new Set([owner]) });
    }
    let rolledBack = false;
    return {
      canonicalPath: candidate.canonical,
      added: !existing,
      async rollback() {
        if (rolledBack) return;
        rolledBack = true;
        await state.mutation.runExclusive(async () => {
          const current = state.records.get(candidate.canonical);
          if (!current || !current.trustedOwners.has(owner)) return;
          current.trustedOwners.delete(owner);
          // Another expansion transaction can make this root durable; never remove it.
          if (!current.durable && current.trustedOwners.size === 0 && await identityStillMatches(candidate.canonical, current.identity)) state.records.delete(candidate.canonical);
        });
      },
    };
  });
}

export async function unregisterTrustedCreatedRoot(service: AllowedRootService, target: string): Promise<void> {
  const state = stateFor(service);
  const canonical = resolve(target);
  await state.mutation.runExclusive(async () => {
    const current = state.records.get(canonical);
    if (!current || current.trustedOwners.size === 0) return;
    try { await lstat(canonical); return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return; }
    current.trustedOwners.clear();
    if (!current.durable) state.records.delete(canonical);
  });
}

export async function createAllowedRootService(policy: AllowedRootPolicy): Promise<AllowedRootService> {
  const maxRoots = policy.maxRoots ?? 128;
  if (!Number.isInteger(maxRoots) || maxRoots < 1) throw new Error("maxRoots must be a positive integer");
  const state: RootState = { records: new Map(), maxRoots, policy, mutation: new AsyncMutex() };
  for (const root of policy.roots) {
    if (state.records.size >= maxRoots) throw new Error("Too many configured allowed roots");
    const candidate = await canonicalDirectoryWithIdentity(root);
    state.records.set(candidate.canonical, { identity: candidate.identity, durable: true, trustedOwners: new Set() });
  }

  async function authorizeExisting(target: string, kind: "any" | "file" | "directory" = "any"): Promise<AuthorizedPath> {
    const requestedPath = validateAbsolutePath(target);
    let canonicalPath: string;
    try { canonicalPath = await realpath(requestedPath); } catch { throw new HttpError(404, "PATH_NOT_FOUND", "Path not found"); }
    const root = matchingRoot(state, canonicalPath);
    if (!root) throw new HttpError(403, "PATH_FORBIDDEN", "Path is outside the allowed roots");
    const record = state.records.get(root);
    if (!record) throw new HttpError(403, "PATH_FORBIDDEN", "Path is outside the allowed roots");
    await verifyRecord(root, record);
    const info = await lstat(canonicalPath);
    if (kind === "file" && !info.isFile()) throw new HttpError(400, "NOT_FILE", "Path is not a file");
    if (kind === "directory" && !info.isDirectory()) throw new HttpError(400, "NOT_DIRECTORY", "Path is not a directory");
    return { requestedPath, canonicalPath, root };
  }

  async function authorizeChild(parent: string, name: string): Promise<AuthorizedPath> {
    validateChildName(name);
    const authorizedParent = await authorizeExisting(parent, "directory");
    const requestedPath = resolve(authorizedParent.canonicalPath, name);
    if (!isWithin(authorizedParent.root, requestedPath)) throw new HttpError(403, "PATH_FORBIDDEN", "Upload target escapes the allowed root");
    try {
      const info = await lstat(requestedPath);
      if (info.isSymbolicLink() || !info.isFile()) throw new HttpError(409, "UNSAFE_TARGET", "Only regular file targets can be replaced");
      const canonicalPath = await realpath(requestedPath);
      if (!isWithin(authorizedParent.root, canonicalPath)) throw new HttpError(403, "PATH_FORBIDDEN", "Upload target escapes the allowed root");
      return { requestedPath, canonicalPath, root: authorizedParent.root };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const canonicalParent = await realpath(dirname(requestedPath));
    if (canonicalParent !== authorizedParent.canonicalPath || !isWithin(authorizedParent.root, canonicalParent)) throw new HttpError(403, "PATH_FORBIDDEN", "Upload parent changed during authorization");
    return { requestedPath, canonicalPath: requestedPath, root: authorizedParent.root };
  }

  async function prepareExpansion(targets: readonly string[], mode: HostMode): Promise<RootExpansionPlan> {
    // Canonicalization intentionally occurs outside the mutation lock.
    const candidates = await Promise.all(targets.map(canonicalDirectoryWithIdentity));
    let committed = false;
    return {
      paths: candidates.map((candidate) => candidate.canonical),
      async commit() {
        return state.mutation.runExclusive(async () => {
          if (committed) throw new HttpError(409, "EXPANSION_ALREADY_COMMITTED", "Root expansion was already committed");
          // Recompute coverage/capacity from the latest state while locked.
          const durableNew = new Map<string, RootIdentity>();
          for (const candidate of candidates) {
            const containing = matchingRoot(state, candidate.canonical);
            if (containing) {
              const record = state.records.get(containing)!;
              await verifyRecord(containing, record);
            }
          }
          for (const candidate of candidates) {
            if (matchingRoot(state, candidate.canonical)) continue;
            const coveredByCandidate = candidates.some((other) => other !== candidate && isWithin(other.canonical, candidate.canonical));
            if (!coveredByCandidate) durableNew.set(candidate.canonical, candidate.identity);
          }
          if (durableNew.size > 0) {
            const permitted = mode === "local" ? policy.allowLocalExpansion === true : policy.allowLanExpansion === true;
            if (!permitted) throw new HttpError(403, "ROOT_EXPANSION_DISABLED", "Directory expansion is disabled by host policy");
            if (state.records.size + durableNew.size > maxRoots) throw new HttpError(429, "ROOT_LIMIT", "Allowed-root limit reached");
          }
          for (const candidate of candidates) if (!(await identityStillMatches(candidate.canonical, candidate.identity))) throw new HttpError(409, "ROOT_IDENTITY_CHANGED", "Directory changed identity during root expansion");
          const added: string[] = [];
          for (const [canonical, identity] of durableNew) {
            const existing = state.records.get(canonical);
            if (existing) existing.durable = true;
            else { state.records.set(canonical, { identity, durable: true, trustedOwners: new Set() }); added.push(canonical); }
          }
          // A candidate may exactly match a trusted-created root: successful policy expansion takes ownership durably.
          for (const candidate of candidates) {
            const exact = state.records.get(candidate.canonical);
            if (exact) exact.durable = true;
          }
          committed = true;
          return { paths: candidates.map((candidate) => candidate.canonical), added };
        });
      },
    };
  }
  async function expandRoots(targets: readonly string[], mode: HostMode): Promise<RootExpansionResult> {
    if (targets.length === 0) return { paths: [], added: [] };
    return (await prepareExpansion(targets, mode)).commit();
  }
  const service: AllowedRootService = {
    roots: () => Object.freeze([...state.records.keys()].sort()),
    async isAuthorized(target, kind = "any") { try { await authorizeExisting(target, kind); return true; } catch { return false; } },
    authorizeExisting,
    authorizeChild,
    prepareExpansion,
    expandRoots,
  };
  states.set(service, state);
  return service;
}

export const pathContainment = { isWithin, validateAbsolutePath, validateChildName };

import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { HttpError } from "../errors.js";
import type { HostMode } from "../types.js";

export interface AllowedRootPolicy {
  roots: readonly string[];
  /** Local UI may explicitly add validated directories when enabled. */
  allowLocalExpansion?: boolean;
  /** LAN expansion is disabled unless the operator explicitly opts in. */
  allowLanExpansion?: boolean;
  maxRoots?: number;
}

export interface AuthorizedPath {
  requestedPath: string;
  canonicalPath: string;
  root: string;
}

export interface RootExpansionResult {
  /** Canonical paths in the same order as the requested paths. */
  paths: readonly string[];
  /** Roots newly added by this atomic expansion. */
  added: readonly string[];
}

export interface RootExpansionPlan {
  readonly paths: readonly string[];
  commit(): Promise<RootExpansionResult>;
}

export interface AllowedRootService {
  roots(): readonly string[];
  /** Read-only authorization query. Never mutates the allowed-root set. */
  isAuthorized(target: string, kind?: "any" | "file" | "directory"): Promise<boolean>;
  authorizeExisting(target: string, kind?: "any" | "file" | "directory"): Promise<AuthorizedPath>;
  authorizeChild(parent: string, name: string): Promise<AuthorizedPath>;
  /** Prepare without mutation; commit revalidates all identities then mutates once. */
  prepareExpansion(targets: readonly string[], mode: HostMode): Promise<RootExpansionPlan>;
  /** Atomically validate and policy-authorize all roots before adding any. */
  expandRoots(targets: readonly string[], mode: HostMode): Promise<RootExpansionResult>;
}

interface RootIdentity { dev: number; ino: number }
interface RootState {
  roots: Set<string>;
  identities: Map<string, RootIdentity>;
  maxRoots: number;
  policy: AllowedRootPolicy;
  trustedCreated: Set<string>;
}

/** Package-internal receipt used only by Host-created resource transactions. */
export interface TrustedCreatedRootReceipt {
  canonicalPath: string;
  added: boolean;
  rollback(): void;
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
  if (!name || name === "." || name === ".." || name.includes("\0") || name.includes("/") || name.includes("\\")) {
    throw new HttpError(400, "INVALID_FILE_NAME", "File name must be a single safe path segment");
  }
}

function stateFor(service: AllowedRootService): RootState {
  const state = states.get(service);
  if (!state) throw new Error("Unknown AllowedRootService instance");
  return state;
}

/**
 * Package-internal trusted-created registration. It is intentionally not
 * re-exported by package index; only a successful Host creation transaction
 * may call it, and the receipt rolls back only this call's newly added root.
 */
export async function registerTrustedCreatedRoot(
  service: AllowedRootService,
  target: string,
): Promise<TrustedCreatedRootReceipt> {
  const state = stateFor(service);
  const candidate = await canonicalDirectoryWithIdentity(target);
  if (!(await identityStillMatches(candidate.canonical, candidate.identity))) {
    throw new HttpError(409, "ROOT_IDENTITY_CHANGED", "Created root changed identity before registration");
  }
  const alreadyPresent = state.roots.has(candidate.canonical);
  if (!alreadyPresent && state.roots.size >= state.maxRoots) throw new HttpError(429, "ROOT_LIMIT", "Allowed-root limit reached");
  if (!alreadyPresent) {
    state.roots.add(candidate.canonical);
    state.identities.set(candidate.canonical, candidate.identity);
    state.trustedCreated.add(candidate.canonical);
  }
  let rolledBack = false;
  return {
    canonicalPath: candidate.canonical,
    added: !alreadyPresent,
    rollback() {
      if (rolledBack) return;
      rolledBack = true;
      if (!alreadyPresent && state.trustedCreated.has(candidate.canonical)) {
        const current = state.identities.get(candidate.canonical);
        if (current?.dev === candidate.identity.dev && current.ino === candidate.identity.ino) {
          state.roots.delete(candidate.canonical);
          state.identities.delete(candidate.canonical);
          state.trustedCreated.delete(candidate.canonical);
        }
      }
    },
  };
}

export async function unregisterTrustedCreatedRoot(service: AllowedRootService, target: string): Promise<void> {
  const state = stateFor(service);
  const canonical = resolve(target);
  if (!state.trustedCreated.has(canonical)) return;
  // A delete transaction may only unregister an absent path. If another
  // transaction already recreated/re-registered the same path, preserve it.
  try { await lstat(canonical); return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return; }
  state.trustedCreated.delete(canonical);
  state.roots.delete(canonical);
  state.identities.delete(canonical);
}

export async function createAllowedRootService(policy: AllowedRootPolicy): Promise<AllowedRootService> {
  const maxRoots = policy.maxRoots ?? 128;
  if (!Number.isInteger(maxRoots) || maxRoots < 1) throw new Error("maxRoots must be a positive integer");
  const state: RootState = { roots: new Set(), identities: new Map(), maxRoots, policy, trustedCreated: new Set() };
  for (const root of policy.roots) {
    if (state.roots.size >= maxRoots) throw new Error("Too many configured allowed roots");
    const resolvedRoot = await canonicalDirectoryWithIdentity(root);
    state.roots.add(resolvedRoot.canonical);
    state.identities.set(resolvedRoot.canonical, resolvedRoot.identity);
  }

  function matchingRoot(canonical: string): string | null {
    let winner: string | null = null;
    for (const root of state.roots) if (isWithin(root, canonical) && (!winner || root.length > winner.length)) winner = root;
    return winner;
  }

  async function verifyRootIdentity(root: string): Promise<void> {
    const expected = state.identities.get(root);
    if (!expected || !(await identityStillMatches(root, expected))) {
      throw new HttpError(403, "ROOT_REPLACED", "Allowed root was replaced after authorization");
    }
  }

  async function authorizeExisting(target: string, kind: "any" | "file" | "directory" = "any"): Promise<AuthorizedPath> {
    const requestedPath = validateAbsolutePath(target);
    let canonicalPath: string;
    try { canonicalPath = await realpath(requestedPath); }
    catch { throw new HttpError(404, "PATH_NOT_FOUND", "Path not found"); }
    const root = matchingRoot(canonicalPath);
    if (!root) throw new HttpError(403, "PATH_FORBIDDEN", "Path is outside the allowed roots");
    await verifyRootIdentity(root);
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
    if (canonicalParent !== authorizedParent.canonicalPath || !isWithin(authorizedParent.root, canonicalParent)) {
      throw new HttpError(403, "PATH_FORBIDDEN", "Upload parent changed during authorization");
    }
    return { requestedPath, canonicalPath: requestedPath, root: authorizedParent.root };
  }

  async function prepareExpansion(targets: readonly string[], mode: HostMode): Promise<RootExpansionPlan> {
    const candidates = await Promise.all(targets.map(canonicalDirectoryWithIdentity));
    const uniqueNew = new Map<string, RootIdentity>();
    for (const candidate of candidates) {
      const containing = matchingRoot(candidate.canonical);
      if (containing) await verifyRootIdentity(containing);
    }
    // Add only minimal candidate roots. A projectRoot candidate authorizes its
    // nested cwd without consuming a second root slot.
    for (const candidate of candidates) {
      if (matchingRoot(candidate.canonical)) continue;
      const coveredByCandidate = candidates.some((other) => other !== candidate && isWithin(other.canonical, candidate.canonical));
      if (!coveredByCandidate) uniqueNew.set(candidate.canonical, candidate.identity);
    }
    if (uniqueNew.size > 0) {
      const permitted = mode === "local" ? policy.allowLocalExpansion === true : policy.allowLanExpansion === true;
      if (!permitted) throw new HttpError(403, "ROOT_EXPANSION_DISABLED", "Directory expansion is disabled by host policy");
      if (state.roots.size + uniqueNew.size > maxRoots) throw new HttpError(429, "ROOT_LIMIT", "Allowed-root limit reached");
    }
    let committed = false;
    return {
      paths: candidates.map((candidate) => candidate.canonical),
      async commit() {
        if (committed) throw new HttpError(409, "EXPANSION_ALREADY_COMMITTED", "Root expansion was already committed");
        // Re-check capacity/policy because another expansion may have committed.
        const stillNew = [...uniqueNew].filter(([canonical]) => !state.roots.has(canonical));
        if (stillNew.length > 0) {
          const permitted = mode === "local" ? policy.allowLocalExpansion === true : policy.allowLanExpansion === true;
          if (!permitted) throw new HttpError(403, "ROOT_EXPANSION_DISABLED", "Directory expansion is disabled by host policy");
          if (state.roots.size + stillNew.length > maxRoots) throw new HttpError(429, "ROOT_LIMIT", "Allowed-root limit reached");
        }
        for (const candidate of candidates) {
          if (!(await identityStillMatches(candidate.canonical, candidate.identity))) throw new HttpError(409, "ROOT_IDENTITY_CHANGED", "Directory changed identity during root expansion");
        }
        for (const [canonical, identity] of stillNew) { state.roots.add(canonical); state.identities.set(canonical, identity); }
        committed = true;
        return { paths: candidates.map((candidate) => candidate.canonical), added: stillNew.map(([canonical]) => canonical) };
      },
    };
  }

  async function expandRoots(targets: readonly string[], mode: HostMode): Promise<RootExpansionResult> {
    if (targets.length === 0) return { paths: [], added: [] };
    return (await prepareExpansion(targets, mode)).commit();
  }

  const service: AllowedRootService = {
    roots: () => Object.freeze([...state.roots].sort()),
    async isAuthorized(target, kind = "any") {
      try { await authorizeExisting(target, kind); return true; }
      catch { return false; }
    },
    authorizeExisting,
    authorizeChild,
    prepareExpansion,
    expandRoots,
  };
  states.set(service, state);
  return service;
}

export const pathContainment = { isWithin, validateAbsolutePath, validateChildName };

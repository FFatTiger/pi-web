import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { HttpError } from "../errors.js";
import type { HostMode } from "../types.js";

export interface AllowedRootPolicy {
  roots: readonly string[];
  /** Local UI may explicitly add a validated directory when enabled. */
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

export interface AllowedRootService {
  roots(): readonly string[];
  authorizeExisting(target: string, kind?: "any" | "file" | "directory"): Promise<AuthorizedPath>;
  authorizeChild(parent: string, name: string): Promise<AuthorizedPath>;
  addRoot(target: string, mode: HostMode): Promise<string>;
  /** Register a root already established by a trusted Host operation (for example git worktree add). */
  addVerifiedRoot(target: string): Promise<string>;
  removeVerifiedRoot(target: string): void;
}

function isWithin(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function validateAbsolutePath(value: string): string {
  if (!value || value.includes("\0")) {
    throw new HttpError(400, "INVALID_PATH", "Path is required and must not contain NUL bytes");
  }
  if (!isAbsolute(value)) {
    throw new HttpError(400, "INVALID_PATH", "Path must be absolute");
  }
  return resolve(value);
}

interface RootIdentity {
  dev: number;
  ino: number;
}

async function canonicalDirectoryWithIdentity(value: string): Promise<{ canonical: string; identity: RootIdentity }> {
  const normalized = validateAbsolutePath(value);
  let canonical: string;
  try {
    canonical = await realpath(normalized);
  } catch {
    throw new HttpError(404, "PATH_NOT_FOUND", "Directory not found");
  }
  const info = await lstat(canonical);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new HttpError(400, "NOT_DIRECTORY", "Path is not a real directory");
  }
  return { canonical, identity: { dev: info.dev, ino: info.ino } };
}

function validateChildName(name: string): void {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("\0") ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new HttpError(400, "INVALID_FILE_NAME", "File name must be a single safe path segment");
  }
}

export async function createAllowedRootService(
  policy: AllowedRootPolicy,
): Promise<AllowedRootService> {
  const maxRoots = policy.maxRoots ?? 128;
  if (!Number.isInteger(maxRoots) || maxRoots < 1) {
    throw new Error("maxRoots must be a positive integer");
  }
  const rootSet = new Set<string>();
  const rootIdentities = new Map<string, RootIdentity>();
  for (const root of policy.roots) {
    if (rootSet.size >= maxRoots) throw new Error("Too many configured allowed roots");
    const resolvedRoot = await canonicalDirectoryWithIdentity(root);
    rootSet.add(resolvedRoot.canonical);
    rootIdentities.set(resolvedRoot.canonical, resolvedRoot.identity);
  }

  function matchingRoot(canonical: string): string | null {
    let winner: string | null = null;
    for (const root of rootSet) {
      if (isWithin(root, canonical) && (!winner || root.length > winner.length)) winner = root;
    }
    return winner;
  }

  async function verifyRootIdentity(root: string): Promise<void> {
    const expected = rootIdentities.get(root);
    if (!expected) throw new HttpError(403, "ROOT_REPLACED", "Allowed root identity is unavailable");
    try {
      if (await realpath(root) !== root) throw new Error("root path changed");
      const current = await lstat(root);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== expected.dev || current.ino !== expected.ino) throw new Error("root identity changed");
    } catch {
      throw new HttpError(403, "ROOT_REPLACED", "Allowed root was replaced after authorization");
    }
  }

  async function authorizeExisting(
    target: string,
    kind: "any" | "file" | "directory" = "any",
  ): Promise<AuthorizedPath> {
    const requestedPath = validateAbsolutePath(target);
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(requestedPath);
    } catch {
      throw new HttpError(404, "PATH_NOT_FOUND", "Path not found");
    }
    const root = matchingRoot(canonicalPath);
    if (!root) throw new HttpError(403, "PATH_FORBIDDEN", "Path is outside the allowed roots");
    await verifyRootIdentity(root);
    const info = await lstat(canonicalPath);
    if (kind === "file" && !info.isFile()) throw new HttpError(400, "NOT_FILE", "Path is not a file");
    if (kind === "directory" && !info.isDirectory()) {
      throw new HttpError(400, "NOT_DIRECTORY", "Path is not a directory");
    }
    return { requestedPath, canonicalPath, root };
  }

  async function authorizeChild(parent: string, name: string): Promise<AuthorizedPath> {
    validateChildName(name);
    const authorizedParent = await authorizeExisting(parent, "directory");
    const requestedPath = resolve(authorizedParent.canonicalPath, name);
    if (!isWithin(authorizedParent.root, requestedPath)) {
      throw new HttpError(403, "PATH_FORBIDDEN", "Upload target escapes the allowed root");
    }
    // Existing destinations are canonicalized so final-component symlinks are rejected.
    try {
      const info = await lstat(requestedPath);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new HttpError(409, "UNSAFE_TARGET", "Only regular file targets can be replaced");
      }
      const canonicalPath = await realpath(requestedPath);
      if (!isWithin(authorizedParent.root, canonicalPath)) {
        throw new HttpError(403, "PATH_FORBIDDEN", "Upload target escapes the allowed root");
      }
      return { requestedPath, canonicalPath, root: authorizedParent.root };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
    // Re-check the canonical parent immediately before the caller opens the file.
    const canonicalParent = await realpath(dirname(requestedPath));
    if (canonicalParent !== authorizedParent.canonicalPath || !isWithin(authorizedParent.root, canonicalParent)) {
      throw new HttpError(403, "PATH_FORBIDDEN", "Upload parent changed during authorization");
    }
    return { requestedPath, canonicalPath: requestedPath, root: authorizedParent.root };
  }

  async function addRoot(target: string, mode: HostMode): Promise<string> {
    const permitted = mode === "local" ? policy.allowLocalExpansion === true : policy.allowLanExpansion === true;
    if (!permitted) {
      throw new HttpError(403, "ROOT_EXPANSION_DISABLED", "Directory expansion is disabled by host policy");
    }
    const resolvedRoot = await canonicalDirectoryWithIdentity(target);
    const canonical = resolvedRoot.canonical;
    if (rootSet.size >= maxRoots && !rootSet.has(canonical)) {
      throw new HttpError(429, "ROOT_LIMIT", "Allowed-root limit reached");
    }
    rootSet.add(canonical);
    rootIdentities.set(canonical, resolvedRoot.identity);
    return canonical;
  }

  async function addVerifiedRoot(target: string): Promise<string> {
    const resolvedRoot = await canonicalDirectoryWithIdentity(target);
    const canonical = resolvedRoot.canonical;
    if (rootSet.size >= maxRoots && !rootSet.has(canonical)) {
      throw new HttpError(429, "ROOT_LIMIT", "Allowed-root limit reached");
    }
    rootSet.add(canonical);
    rootIdentities.set(canonical, resolvedRoot.identity);
    return canonical;
  }

  function removeVerifiedRoot(target: string): void {
    const normalized = resolve(target);
    rootSet.delete(normalized);
    rootIdentities.delete(normalized);
  }

  return {
    roots: () => Object.freeze([...rootSet].sort()),
    authorizeExisting,
    authorizeChild,
    addRoot,
    addVerifiedRoot,
    removeVerifiedRoot,
  };
}

export const pathContainment = { isWithin, validateAbsolutePath, validateChildName };

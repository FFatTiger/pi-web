import { lstatSync, readdirSync, realpathSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAdditionalAllowedRoots, normalizeSlashes } from "./allowed-roots";
import { isPushSecretPath } from "./push-paths";
import { listAllSessions } from "./session-reader";
export { allowFileRoot, normalizeSlashes } from "./allowed-roots";

// Short-TTL cache for the allowed-roots set. Without this, every file list/read
// request re-scans every pi session on disk just to check access. 5s is short
// enough that newly-created cwds appear promptly; stored on globalThis so it
// survives Next.js hot-reload.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
}

const ALLOWED_ROOTS_TTL_MS = 5_000;
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

export async function getAllowedFileRoots(): Promise<Set<string>> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRootsCache;
  if (cached && cached.expiresAt > now) return cached.roots;

  const sessions = await listAllSessions();
  const roots = new Set<string>();
  for (const s of sessions) {
    if (s.cwd) roots.add(normalizeSlashes(s.cwd));
    // The project root (main repo shared by all worktrees) is browsable too —
    // the project dropdown lists it even when only worktrees have sessions.
    if (s.projectRoot) roots.add(normalizeSlashes(s.projectRoot));
  }

  // Also allow ~/pi-cwd-* directories created by the default-cwd endpoint.
  try {
    for (const name of readdirSync(homedir())) {
      if (/^pi-cwd-\d{8}$/.test(name)) {
        roots.add(normalizeSlashes(path.join(homedir(), name)));
      }
    }
  } catch {
    // ignore if home is unreadable
  }

  for (const root of getAdditionalAllowedRoots()) roots.add(root);

  globalThis.__piAllowedRootsCache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
  return roots;
}

export function isFilePathDenied(target: string, agentDir: string = getAgentDir()): boolean {
  return isPushSecretPath(target, agentDir);
}

/**
 * Deny the managed Push secret using raw path identity and, when needed,
 * realpath / parent-realpath reconstruction so symlinks and non-existing
 * destinations under a symlinked agent dir cannot bypass the gate.
 */
export function isResolvedFilePathDenied(target: string, agentDir: string = getAgentDir()): boolean {
  if (isFilePathDenied(target, agentDir)) return true;

  const resolved = path.resolve(target);
  try {
    return isPushSecretPath(realpathSync(resolved), agentDir);
  } catch {
    // Target does not exist (typical for new uploads/temps). Realpath the parent
    // and reattach the basename so a symlinked agent directory still denies.
    try {
      const parentReal = realpathSync(path.dirname(resolved));
      return isPushSecretPath(path.join(parentReal, path.basename(resolved)), agentDir);
    } catch {
      return false;
    }
  }
}

/**
 * Remove managed Push secrets, atomic temp siblings, case aliases, and
 * symlink/alias names that resolve to them from a relative file-index listing.
 *
 * Performance: canonicalize cwd once; raw-deny via string identity; lstat +
 * realpath only for symlink candidates (not every entry's realpath).
 */
export function filterDeniedFileIndexPaths(
  files: string[],
  cwd: string,
  agentDir: string = getAgentDir(),
): string[] {
  let realCwd: string;
  try {
    realCwd = realpathSync(cwd);
  } catch {
    realCwd = path.resolve(cwd);
  }

  return files.filter((rel) => {
    const abs = path.resolve(realCwd, rel);
    if (isFilePathDenied(abs, agentDir)) return false;

    try {
      if (!lstatSync(abs).isSymbolicLink()) return true;
      return !isResolvedFilePathDenied(abs, agentDir);
    } catch {
      // Missing path: still deny if the reconstructed parent identity is secret.
      return !isResolvedFilePathDenied(abs, agentDir);
    }
  });
}

export function isFilePathAllowed(
  target: string,
  allowedRoots: Set<string>,
  agentDir?: string,
): boolean {
  // Hardened: resolved/canonical denial so symlink and case aliases cannot
  // slip through callers that only go through isFilePathAllowed.
  if (isResolvedFilePathDenied(target, agentDir)) return false;
  for (const root of allowedRoots) {
    const useWindowsRules = isWindowsAbsolutePath(target) || isWindowsAbsolutePath(root);
    const resolver = useWindowsRules ? path.win32 : path;
    const sep = useWindowsRules ? "\\" : path.sep;
    const normalized = resolver.resolve(target);
    const normalizedRoot = resolver.resolve(root);
    const comparable = useWindowsRules ? normalized.toLowerCase() : normalized;
    const comparableRoot = useWindowsRules ? normalizedRoot.toLowerCase() : normalizedRoot;
    const rootWithSep = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
    if (comparable === comparableRoot || comparable.startsWith(rootWithSep)) {
      return true;
    }
  }
  return false;
}

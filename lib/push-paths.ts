import { realpathSync } from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const PUSH_STATE_FILE_NAME = "pi-web-push.json";
export const PUSH_TEMP_FILE_PREFIX = `${PUSH_STATE_FILE_NAME}.tmp-`;

/**
 * Secret path identity is case-insensitive on every platform.
 *
 * Rationale: default macOS (APFS case-insensitive) and Windows treat
 * `PI-WEB-PUSH.JSON` as the same inode as `pi-web-push.json`. A case-sensitive
 * string compare would allow content/name exposure via case aliases. On
 * case-sensitive volumes (some Linux, rare macOS volumes) this may deny a
 * differently cased distinct file in the agent dir; that over-deny is
 * intentional and security-preserving. Nested paths and `.bak` siblings are
 * still allowed.
 *
 * Directory identity also goes through realpath when possible so macOS
 * `/var` ↔ `/private/var` (and other symlink-aliases of the agent dir) cannot
 * bypass denial.
 */
function fold(p: string): string {
  return p.toLowerCase();
}

function resolveDirIdentity(dir: string): string {
  const resolved = path.resolve(dir);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function getPushStatePath(agentDir: string = getAgentDir()): string {
  return path.resolve(agentDir, PUSH_STATE_FILE_NAME);
}

export function isPushSecretPath(target: string, agentDir: string = getAgentDir()): boolean {
  const resolvedDir = resolveDirIdentity(agentDir);
  const resolvedTarget = path.resolve(target);
  const targetParent = resolveDirIdentity(path.dirname(resolvedTarget));
  if (fold(targetParent) !== fold(resolvedDir)) return false;
  const name = path.basename(resolvedTarget);
  const foldedName = fold(name);
  return foldedName === fold(PUSH_STATE_FILE_NAME) || foldedName.startsWith(fold(PUSH_TEMP_FILE_PREFIX));
}

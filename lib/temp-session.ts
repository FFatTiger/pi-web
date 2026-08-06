import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Root for temporary / "Recent" scratch sessions: ~/.pi/agent/temp-session */
export function getTempSessionRoot(agentDir = getAgentDir()): string {
  return join(agentDir, "temp-session");
}

/** Client-safe basename marker used when grouping recent/temp sessions. */
export const TEMP_SESSION_ROOT_SEGMENT = ".pi/agent/temp-session";

function localDateStamp(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Create a Codex-style temporary session cwd:
 *   ~/.pi/agent/temp-session/YYYY-MM-DD/f
 *   ~/.pi/agent/temp-session/YYYY-MM-DD/f-2
 *   ...
 */
export function createTempSessionCwd(now = new Date()): string {
  const root = getTempSessionRoot();
  const dayDir = join(root, localDateStamp(now));
  mkdirSync(dayDir, { recursive: true });

  let name = "f";
  if (existsSync(join(dayDir, name))) {
    let n = 2;
    while (existsSync(join(dayDir, `f-${n}`))) n += 1;
    name = `f-${n}`;
  }

  const cwd = join(dayDir, name);
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

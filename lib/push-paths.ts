import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const PUSH_STATE_FILE_NAME = "pi-web-push.json";
export const PUSH_TEMP_FILE_PREFIX = `${PUSH_STATE_FILE_NAME}.tmp-`;

export function getPushStatePath(agentDir: string = getAgentDir()): string {
  return path.resolve(agentDir, PUSH_STATE_FILE_NAME);
}

export function isPushSecretPath(target: string, agentDir: string = getAgentDir()): boolean {
  const resolvedDir = path.resolve(agentDir);
  const resolvedTarget = path.resolve(target);
  if (path.dirname(resolvedTarget) !== resolvedDir) return false;
  const name = path.basename(resolvedTarget);
  return name === PUSH_STATE_FILE_NAME || name.startsWith(PUSH_TEMP_FILE_PREFIX);
}

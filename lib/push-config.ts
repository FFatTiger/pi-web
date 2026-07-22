import { readFileSync } from "node:fs";
import { getWebAuthConfigPath } from "./web-auth-config";

const DEFAULT_SUBJECT = "https://github.com/agegr/pi-web";

function parseBoolean(value: string | undefined): boolean | undefined | "invalid" {
  if (value === undefined) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return "invalid";
}

function validSubject(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "mailto:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export type PushConfig =
  | { status: "enabled"; configPath: string; subject: string }
  | { status: "disabled"; configPath: string }
  | { status: "error"; configPath: string; code: "PUSH_CONFIG_ERROR"; logMessage: string };

export type ReadPushConfigOptions = {
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  readFile?: (path: string, encoding: BufferEncoding) => string;
};

export function readPushConfig(options?: ReadPushConfigOptions): PushConfig {
  const env = options?.env ?? process.env;
  const configPath = options?.configPath ?? getWebAuthConfigPath();
  const readFile = options?.readFile ?? readFileSync;

  let filePush: { disabled?: boolean; subject?: string } = {};

  try {
    const parsed: unknown = JSON.parse(readFile(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "error", configPath, code: "PUSH_CONFIG_ERROR", logMessage: `${configPath} must contain a JSON object` };
    }
    const push = (parsed as { push?: unknown }).push;
    if (push !== undefined) {
      if (!push || typeof push !== "object" || Array.isArray(push)) {
        return { status: "error", configPath, code: "PUSH_CONFIG_ERROR", logMessage: `${configPath}: push must be an object` };
      }
      const candidate = push as { disabled?: unknown; subject?: unknown };
      if (candidate.disabled !== undefined && typeof candidate.disabled !== "boolean") {
        return { status: "error", configPath, code: "PUSH_CONFIG_ERROR", logMessage: `${configPath}: push.disabled must be a boolean` };
      }
      if (candidate.subject !== undefined && typeof candidate.subject !== "string") {
        return { status: "error", configPath, code: "PUSH_CONFIG_ERROR", logMessage: `${configPath}: push.subject must be a string` };
      }
      filePush = {
        disabled: candidate.disabled as boolean | undefined,
        subject: candidate.subject as string | undefined,
      };
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      return { status: "error", configPath, code: "PUSH_CONFIG_ERROR", logMessage: `Failed to read ${configPath}: ${String(error)}` };
    }
  }

  const envDisabled = parseBoolean(env.PI_WEB_PUSH_DISABLED);
  if (envDisabled === "invalid") {
    return { status: "error", configPath, code: "PUSH_CONFIG_ERROR", logMessage: "PI_WEB_PUSH_DISABLED must be true or false" };
  }

  const disabled = envDisabled !== undefined ? envDisabled : filePush.disabled ?? false;
  if (disabled) return { status: "disabled", configPath };

  const envSubject = env.PI_WEB_PUSH_SUBJECT;
  const fileSubject = filePush.subject;
  const subject = envSubject !== undefined ? envSubject : fileSubject ?? DEFAULT_SUBJECT;

  if (!validSubject(subject)) {
    return { status: "error", configPath, code: "PUSH_CONFIG_ERROR", logMessage: "Invalid subject (must be mailto: or https: URL)" };
  }

  return { status: "enabled", configPath, subject };
}

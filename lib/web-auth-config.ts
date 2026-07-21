import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { GateConfig, GatePublicStatus, ReadGateConfigOptions } from "./web-auth-types";

export function getWebAuthConfigPath(): string {
  return join(getAgentDir(), "pi-web.json");
}

function parseDisabled(value: string | undefined): boolean | undefined | "invalid" {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return "invalid";
}

export function readGateConfig(options: ReadGateConfigOptions = {}): GateConfig {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? getWebAuthConfigPath();
  const readFile = options.readFile ?? readFileSync;
  let fileAuth: { password?: string; disabled?: boolean } = {};

  try {
    const parsed: unknown = JSON.parse(readFile(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "error", configPath, logMessage: `${configPath} must contain a JSON object` };
    }

    const auth = (parsed as { auth?: unknown }).auth;
    if (auth !== undefined) {
      if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
        return { status: "error", configPath, logMessage: `${configPath}: auth must be an object` };
      }
      const candidate = auth as { password?: unknown; disabled?: unknown };
      if (candidate.password !== undefined && typeof candidate.password !== "string") {
        return { status: "error", configPath, logMessage: `${configPath}: auth.password must be a string` };
      }
      if (candidate.disabled !== undefined && typeof candidate.disabled !== "boolean") {
        return { status: "error", configPath, logMessage: `${configPath}: auth.disabled must be a boolean` };
      }
      fileAuth = {
        password: candidate.password as string | undefined,
        disabled: candidate.disabled as boolean | undefined,
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { status: "error", configPath, logMessage: `Failed to read ${configPath}: ${String(error)}` };
    }
  }

  const envDisabled = parseDisabled(env.PI_WEB_AUTH_DISABLED);
  if (envDisabled === "invalid") {
    return { status: "error", configPath, logMessage: "PI_WEB_AUTH_DISABLED must be true or false" };
  }

  const disabled = envDisabled ?? fileAuth.disabled ?? false;
  const password = env.PI_WEB_PASSWORD !== undefined ? env.PI_WEB_PASSWORD : fileAuth.password;
  if (disabled) return { status: "disabled", configPath };
  if (typeof password === "string" && password.trim()) {
    return { status: "enabled", configPath, password };
  }
  return { status: "unconfigured", configPath };
}

export function toPublicGateStatus(config: GateConfig): GatePublicStatus {
  return { status: config.status, configPath: config.configPath };
}

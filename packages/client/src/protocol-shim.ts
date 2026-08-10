/**
 * Temporary protocol / capability type shim.
 *
 * TODO(protocol): replace this module with imports from
 * `@fffattiger/pi-web-protocol` once the shared package is published and frozen.
 * Keep all client-local protocol shapes here so call sites stay single-source.
 */

/** Host capability tokens negotiated at handshake. */
export type HostCapability =
  | "agent"
  | "files"
  | "files.write"
  | "git"
  | "worktree";

export type HostMode = "local" | "lan";

export type ClientShell = "web" | "pwa";

export interface ClientIdentity {
  shell: ClientShell;
  platform: "win" | "mac" | "linux" | "ios" | "android" | "unknown";
}

export interface HostInfo {
  mode: HostMode;
  capabilities: readonly HostCapability[];
}

export interface ProtocolHandshakeRequest {
  protocolVersion: 1;
  client: ClientIdentity;
  features: string[];
  auth?: string;
}

export interface ProtocolHandshakeResponse {
  protocolVersion: 1;
  host: HostInfo;
  limits: {
    maxUpload: number;
    maxOpenSessions: number;
  };
  sessionSnapshotSupport: boolean;
}

export const PROTOCOL_VERSION = 1 as const;

export const ALL_HOST_CAPABILITIES: readonly HostCapability[] = [
  "agent",
  "files",
  "files.write",
  "git",
  "worktree",
] as const;

/** Default capabilities when host has not yet been contacted (readonly shell). */
export const DEFAULT_READONLY_CAPABILITIES: readonly HostCapability[] = [
  "files",
] as const;

export function hasCapability(
  capabilities: readonly HostCapability[] | undefined,
  capability: HostCapability,
): boolean {
  return Boolean(capabilities?.includes(capability));
}

export function isAgentEnabled(
  capabilities: readonly HostCapability[] | undefined,
): boolean {
  return hasCapability(capabilities, "agent");
}

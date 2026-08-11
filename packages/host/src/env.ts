import type { HostMode } from "./types.js";

/** Variables attached to every request by the foundation middleware. */
export interface HostVariables {
  requestId: string;
  hostMode: HostMode;
  hostname: string;
  /** Trusted transport peer address when available from the Node adapter. */
  peerAddress: string;
  /** True only when peerAddress is explicitly configured as a trusted proxy. */
  trustedProxy: boolean;
  /** Set by the gate middleware on allowed requests. */
  authStatus: "enabled" | "disabled";
}

/** Node adapter bindings exposed by @hono/node-server. */
export interface HostBindings {
  incoming?: { socket?: { remoteAddress?: string } };
}

export type HostEnv = { Bindings: HostBindings; Variables: HostVariables };

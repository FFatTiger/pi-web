import type { Hono } from "hono";
import type { HostEnv } from "../env.js";
import type { HostDeps } from "../types.js";
import {
  ALL_HOST_CAPABILITIES,
  READONLY_HOST_CAPABILITIES,
  type HostCapability,
} from "../types.js";

export type SessiondState = "up" | "down" | "unknown";

export interface ResolvedCapabilities {
  sessiond: SessiondState;
  capabilities: readonly HostCapability[];
}

/**
 * Capability projection: when sessiond is unavailable (or no probe is wired
 * yet) the host offers read-only capabilities only. The probe is deliberately
 * protocol-independent — H0B wires the real sessiond client here.
 */
export async function resolveCapabilities(deps: HostDeps): Promise<ResolvedCapabilities> {
  const full = deps.capabilities?.full ?? ALL_HOST_CAPABILITIES;
  const readonly = deps.capabilities?.readonly ?? READONLY_HOST_CAPABILITIES;
  if (!deps.sessiond) return { sessiond: "unknown", capabilities: readonly };
  const timeoutMs = deps.sessiondProbeTimeoutMs ?? 2_000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let available: boolean;
  try {
    available = await Promise.race([
      Promise.resolve(deps.sessiond.isAvailable()),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    available = false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  return {
    sessiond: available ? "up" : "down",
    capabilities: available ? full : readonly,
  };
}

export function registerHealthRoutes(app: Hono<HostEnv>, deps: HostDeps): void {
  app.get("/v1/health", async (c) => {
    c.header("Cache-Control", "no-store");
    const { sessiond, capabilities } = await resolveCapabilities(deps);
    return c.json({ ok: true, service: "pi-web-host", sessiond, capabilities });
  });

  app.get("/v1/capabilities", async (c) => {
    c.header("Cache-Control", "no-store");
    const { sessiond, capabilities } = await resolveCapabilities(deps);
    return c.json({ ok: true, sessiond, capabilities });
  });
}

/**
 * URL builder for Host HTTP surface.
 * Only `/v1/*` is allowed — never legacy Next route-handler paths.
 */

const API_ROOT = "/v1";

function joinPath(base: string, ...segments: string[]): string {
  const tail = segments
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .join("/");
  if (!tail) return base;
  return `${base}/${tail}`;
}

export function v1Url(...segments: string[]): string {
  return joinPath(API_ROOT, ...segments);
}

export const urls = {
  root: API_ROOT,
  gate: {
    status: () => v1Url("gate", "status"),
    login: () => v1Url("gate", "login"),
    logout: () => v1Url("gate", "logout"),
  },
  // Stubs for upcoming host resources (not wired to live protocol yet).
  sessions: {
    list: () => v1Url("sessions"),
    byId: (id: string) => v1Url("sessions", encodeURIComponent(id)),
  },
  runtime: {
    // WebSocket endpoint lives under /v1; client runtime attach is not implemented in this shell.
    ws: () => v1Url("runtime"),
  },
} as const;

const LEGACY_API_PREFIX = "/" + "api";

export function assertV1Path(path: string): void {
  if (!path.startsWith("/v1")) {
    throw new Error(`Only /v1 paths are allowed, got: ${path}`);
  }
  if (path === LEGACY_API_PREFIX || path.startsWith(`${LEGACY_API_PREFIX}/`)) {
    throw new Error(`Legacy host paths are forbidden: ${path}`);
  }
}

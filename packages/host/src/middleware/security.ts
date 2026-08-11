import { isIP } from "node:net";
import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import type { HostEnv } from "../env.js";
import type { HostMode } from "../types.js";
import { apiErrorBody, isV1Path } from "../errors.js";

export interface SecurityOptions {
  /**
   * Extra trusted hostnames (beyond loopback names and IP literals).
   * Defaults to PI_WEB_HOSTNAME + PI_WEB_ALLOWED_HOSTS from the environment.
   */
  allowedHosts?: readonly string[];
  /** Trusted server exposure; LAN mode cannot be downgraded by Host spoofing. */
  exposureMode?: HostMode;
  /** Socket peers allowed to supply Forwarded/X-Forwarded-* headers. */
  trustedProxyAddresses?: readonly string[];
}

export interface HostCheckResult {
  trusted: boolean;
  hostname: string | null;
  mode: HostMode;
}

// ---------------------------------------------------------------------------
// Host header parsing / DNS-rebinding protection
// ---------------------------------------------------------------------------

function normalizeHostname(value: string): string {
  const unbracketed =
    value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return unbracketed.toLowerCase().replace(/\.$/, "");
}

/** Extract a clean hostname from a Host authority, or null when malformed. */
export function hostnameFromAuthority(value: string | null | undefined): string | null {
  if (!value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return normalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}

function explicitPortFromAuthority(value: string | null | undefined): string | null {
  if (!value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.port || null;
  } catch {
    return null;
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function isLoopbackAddress(ip: string): boolean {
  if (ip === "::1") return true;
  if (ip.startsWith("::ffff:")) return isLoopbackAddress(ip.slice(7));
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts[0] === 127;
}

function configuredHostnamesFromEnvironment(): string[] {
  return [
    process.env.PI_WEB_HOSTNAME,
    ...(process.env.PI_WEB_ALLOWED_HOSTS?.split(",") ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function normalizeConfiguredHostname(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const actualIp = isIP(trimmed);
  if (actualIp) return normalizeHostname(trimmed);
  if (/^\[[^\]]+\](?::\d+)?$/.test(trimmed) || /^[^:]+:\d+$/.test(trimmed)) {
    return hostnameFromAuthority(trimmed);
  }
  if (/^[^\s/@\\:]+$/.test(trimmed)) {
    return normalizeHostname(trimmed);
  }
  return null;
}

/**
 * Trust only local names, IP literals (which cannot be DNS-rebound), or the
 * hostnames explicitly selected by the operator.
 */
export function isHostTrusted(
  hostHeader: string | null | undefined,
  configuredHostnames: readonly string[] = configuredHostnamesFromEnvironment(),
): boolean {
  const hostname = hostnameFromAuthority(hostHeader);
  if (!hostname) return false;
  if (isLoopbackHostname(hostname) || isIP(hostname)) return true;
  return configuredHostnames.some(
    (configured) => normalizeConfiguredHostname(configured) === hostname,
  );
}

/**
 * A request is "local" only when it arrives via loopback names/addresses.
 * Anything else (private/public IP literals, operator hostnames) is "lan" and
 * therefore subject to the gate (D-020).
 */
export function resolveHostMode(hostname: string): HostMode {
  if (isLoopbackHostname(hostname)) return "local";
  if (isIP(hostname) && isLoopbackAddress(hostname)) return "local";
  return "lan";
}

// ---------------------------------------------------------------------------
// Origin checks for API/WS requests
// ---------------------------------------------------------------------------

function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function defaultPortForProtocol(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

function requestProtocol(request: Request, trustForwarded: boolean): string {
  if (trustForwarded) {
    const forwarded = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .toLowerCase();
    if (forwarded === "https" || forwarded === "http") return `${forwarded}:`;
  }
  try {
    return new URL(request.url).protocol;
  } catch {
    return "http:";
  }
}

/**
 * Match Origin host+port against the Host header, ignoring scheme differences
 * caused by upstream TLS termination. Non-default ports must still agree.
 */
function isOriginMatchingRequestHost(origin: string, hostHeader: string): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return false;

  const requestHostname = hostnameFromAuthority(hostHeader);
  if (!requestHostname) return false;
  if (normalizeHostname(originUrl.hostname) !== requestHostname) return false;

  const originPort = originUrl.port || defaultPortForProtocol(originUrl.protocol);
  const hostPort = explicitPortFromAuthority(hostHeader);
  if (hostPort !== null) return originPort === hostPort;
  return originPort === "80" || originPort === "443";
}

/** Reject browser cross-site API requests while preserving non-browser clients. */
export function isOriginAllowed(request: Request, trustForwarded = false): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  if (!origin) return true;

  const requestOrigin = getRequestOrigin(request, trustForwarded);
  if (requestOrigin !== null && canonicalOrigin(origin) === requestOrigin) return true;

  const host = request.headers.get("host");
  return host !== null && isOriginMatchingRequestHost(origin, host);
}

function getRequestOrigin(request: Request, trustForwarded: boolean): string | null {
  const host = request.headers.get("host");
  return host ? canonicalOrigin(`${requestProtocol(request, trustForwarded)}//${host}`) : null;
}

/** Effective request scheme. Forwarding headers require an explicitly trusted peer. */
export function effectiveRequestProtocol(request: Request, trustForwarded = false): string {
  return requestProtocol(request, trustForwarded);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function securityMiddleware(options: SecurityOptions = {}): MiddlewareHandler<HostEnv> {
  const configuredHosts =
    options.allowedHosts !== undefined ? [...options.allowedHosts] : undefined;
  const exposureMode = options.exposureMode ?? "local";
  const trustedProxyAddresses = new Set(options.trustedProxyAddresses ?? []);
  return createMiddleware(async (c, next) => {
    const hostHeader = c.req.header("host");
    const trusted = isHostTrusted(hostHeader, configuredHosts);
    const hostname = hostnameFromAuthority(hostHeader) ?? "";
    if (!trusted) {
      if (isV1Path(c.req.path)) {
        return c.json(apiErrorBody("UNTRUSTED_HOST", "Untrusted API request"), 403);
      }
      return c.text("Untrusted request", 403);
    }
    const peerAddress = c.env?.incoming?.socket?.remoteAddress ?? "unknown";
    const trustedProxy = trustedProxyAddresses.has(peerAddress);
    c.set("hostname", hostname);
    c.set("peerAddress", peerAddress);
    c.set("trustedProxy", trustedProxy);
    // Server exposure is authoritative. Host can only upgrade local → LAN,
    // never downgrade a LAN-bound server by claiming localhost.
    c.set("hostMode", exposureMode === "lan" ? "lan" : resolveHostMode(hostname));
    if (isV1Path(c.req.path) && !isOriginAllowed(c.req.raw, trustedProxy)) {
      return c.json(apiErrorBody("UNTRUSTED_ORIGIN", "Untrusted API request"), 403);
    }
    await next();
  });
}

import { isIP } from "node:net";

function normalizeHostname(value: string): string {
  const unbracketed = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  return unbracketed.toLowerCase().replace(/\.$/, "");
}

function hostnameFromAuthority(value: string): string | null {
  if (!value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    return normalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}

/** Explicit port from a Host authority, or null when absent/default. */
function explicitPortFromAuthority(value: string): string | null {
  if (!value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    return parsed.port || null;
  } catch {
    return null;
  }
}

function normalizeConfiguredHostname(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return isIP(trimmed) ? normalizeHostname(trimmed) : hostnameFromAuthority(trimmed);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function configuredHostnamesFromEnvironment(): string[] {
  return [
    process.env.PI_WEB_HOSTNAME,
    ...(process.env.PI_WEB_ALLOWED_HOSTS?.split(",") ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
}

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

function requestProtocol(request: Request): string {
  // TLS is often terminated at a reverse proxy / tunnel (frp, nginx, Caddy).
  // Only trust X-Forwarded-Proto for non-loopback, non-IP Host values (operator-
  // allowlisted public names). Proxies should overwrite client-supplied values.
  const host = request.headers.get("host");
  const hostname = host ? hostnameFromAuthority(host) : null;
  const trustForwarded = hostname !== null
    && !isLoopbackHostname(hostname)
    && !isIP(hostname);
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

function getRequestOrigin(request: Request): string | null {
  const host = request.headers.get("host");
  return host ? canonicalOrigin(`${requestProtocol(request)}//${host}`) : null;
}

/**
 * Match Origin host+port against the Host header, ignoring scheme differences
 * caused by upstream TLS termination (https Origin vs http internal URL).
 * Non-default ports must still agree; a bare Host only implies 80/443.
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

function isUserInitiatedSessionExportNavigation(request: Request): boolean {
  if (
    request.method !== "GET"
    || request.headers.get("sec-fetch-mode") !== "navigate"
    || request.headers.get("sec-fetch-dest") !== "document"
    || request.headers.get("sec-fetch-user") !== "?1"
  ) {
    return false;
  }

  try {
    return /^\/api\/sessions\/[^/]+\/export$/.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

/**
 * Only trust local names, IP literals, or the hostname explicitly selected by
 * the operator. IP literals preserve LAN access but cannot be DNS-rebound
 * because the browser keeps the literal address in the Host header.
 */
export function isApiRequestHostAllowed(
  request: Request,
  configuredHostnames = configuredHostnamesFromEnvironment(),
): boolean {
  const host = request.headers.get("host");
  const hostname = host ? hostnameFromAuthority(host) : null;
  if (!hostname) return false;
  if (isLoopbackHostname(hostname) || isIP(hostname)) return true;

  return configuredHostnames.some(
    (configured) => normalizeConfiguredHostname(configured) === hostname,
  );
}

/** Reject browser cross-site API requests while preserving non-browser clients. */
export function isApiRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  if (!origin) return true;

  const requestOrigin = getRequestOrigin(request);
  if (requestOrigin !== null && canonicalOrigin(origin) === requestOrigin) return true;

  // Behind HTTPS tunnels the browser Origin is https://host while Next may see
  // http://host. Host was already allow-listed; require host+port agreement.
  const host = request.headers.get("host");
  return host !== null && isOriginMatchingRequestHost(origin, host);
}

export function shouldCheckApiRequestOrigin(request: Request): boolean {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}

export function isApiRequestAllowed(
  request: Request,
  configuredHostnames = configuredHostnamesFromEnvironment(),
): boolean {
  if (!isApiRequestHostAllowed(request, configuredHostnames)) return false;
  if (isUserInitiatedSessionExportNavigation(request)) return true;
  return !shouldCheckApiRequestOrigin(request) || isApiRequestOriginAllowed(request);
}

export function hasJsonContentType(request: Request): boolean {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json"
    || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
}

import { isIP } from "node:net";

function normalizeHostname(value: string): string {
	const unbracketed =
		value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
	return unbracketed.toLowerCase().replace(/\.$/, "");
}

function hostnameFromAuthority(value: string): string | null {
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

function normalizeConfiguredHostname(value: string | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	return isIP(trimmed)
		? normalizeHostname(trimmed)
		: hostnameFromAuthority(trimmed);
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

function requestProtocol(request: Request): string {
	// TLS is often terminated at a reverse proxy / tunnel (frp, nginx, Caddy).
	// Prefer the first X-Forwarded-Proto hop so Origin checks use the external scheme.
	const forwarded = request.headers
		.get("x-forwarded-proto")
		?.split(",")[0]
		?.trim()
		.toLowerCase();
	if (forwarded === "https" || forwarded === "http") return `${forwarded}:`;
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

/** Same external host as Host, ignoring http/https when TLS was terminated upstream. */
function isOriginHostMatchingRequestHost(
	origin: string,
	hostHeader: string,
): boolean {
	const originCanonical = canonicalOrigin(origin);
	if (!originCanonical) return false;
	let originHostname: string;
	try {
		originHostname = normalizeHostname(new URL(originCanonical).hostname);
	} catch {
		return false;
	}
	const requestHostname = hostnameFromAuthority(hostHeader);
	return requestHostname !== null && originHostname === requestHostname;
}

function isUserInitiatedSessionExportNavigation(request: Request): boolean {
	if (
		request.method !== "GET" ||
		request.headers.get("sec-fetch-mode") !== "navigate" ||
		request.headers.get("sec-fetch-dest") !== "document" ||
		request.headers.get("sec-fetch-user") !== "?1"
	) {
		return false;
	}

	try {
		return /^\/api\/sessions\/[^/]+\/export$/.test(
			new URL(request.url).pathname,
		);
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
	if (requestOrigin !== null && canonicalOrigin(origin) === requestOrigin)
		return true;

	// Behind HTTPS tunnels the browser Origin is https://host while Next sees http://host.
	// Host was already allow-listed; matching hostnames is enough to reject foreign origins.
	const host = request.headers.get("host");
	return host !== null && isOriginHostMatchingRequestHost(origin, host);
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
	return (
		!shouldCheckApiRequestOrigin(request) || isApiRequestOriginAllowed(request)
	);
}

export function hasJsonContentType(request: Request): boolean {
	const mediaType = request.headers
		.get("content-type")
		?.split(";", 1)[0]
		?.trim()
		.toLowerCase();
	return (
		mediaType === "application/json" ||
		Boolean(
			mediaType?.startsWith("application/") && mediaType.endsWith("+json"),
		)
	);
}

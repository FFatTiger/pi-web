import type { GateConfig } from "./web-auth-types";
import { verifySessionToken } from "./web-auth-session";

export type GateRequestInput = {
  url: string;
  method: string;
  sessionToken?: string;
};

export type GateDecision =
  | { action: "allow"; authStatus: "enabled" | "disabled" }
  | { action: "redirect"; location: string }
  | { action: "json"; status: 401 | 503; body: { error: string; code?: string } };

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/gate/status",
  "/api/gate/login",
  "/api/gate/logout",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
]);

export function sanitizeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[\\\r\n\u0000-\u001f\u007f]/.test(value)) return "/";
  // Reject encoded protocol-relative shapes before the URL parser normalizes them.
  if (/%2f%2f/i.test(value)) return "/";
  const parsed = new URL(value, "http://pi-web.local");
  if (parsed.origin !== "http://pi-web.local") return "/";
  if (parsed.pathname === "/login") return "/";
  if (parsed.pathname.startsWith("//") || parsed.pathname.includes("\\")) return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function isGatePublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/icons/");
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function decideGateRequest(config: GateConfig, input: GateRequestInput): GateDecision {
  const requestUrl = new URL(input.url);
  const { pathname, search } = requestUrl;

  if (config.status === "disabled") {
    return { action: "allow", authStatus: "disabled" };
  }

  // Public gate API routes always allow so the login page can recover.
  // /login is handled specially below for authenticated users.
  if (pathname !== "/login" && isGatePublicPath(pathname)) {
    return { action: "allow", authStatus: "enabled" };
  }

  if (config.status === "unconfigured") {
    if (pathname === "/login") {
      return { action: "allow", authStatus: "enabled" };
    }
    if (isApiPath(pathname)) {
      return {
        action: "json",
        status: 503,
        body: { error: "Authentication is not configured", code: "AUTH_NOT_CONFIGURED" },
      };
    }
    return { action: "redirect", location: "/login" };
  }

  if (config.status === "error") {
    if (pathname === "/login") {
      return { action: "allow", authStatus: "enabled" };
    }
    if (isApiPath(pathname)) {
      return {
        action: "json",
        status: 503,
        body: { error: "Authentication configuration error", code: "AUTH_CONFIG_ERROR" },
      };
    }
    return { action: "redirect", location: "/login" };
  }

  if (verifySessionToken(input.sessionToken, config.password)) {
    if (pathname === "/login") {
      return {
        action: "redirect",
        location: sanitizeNextPath(requestUrl.searchParams.get("next")),
      };
    }
    return { action: "allow", authStatus: "enabled" };
  }

  if (pathname === "/login") {
    return { action: "allow", authStatus: "enabled" };
  }

  if (isApiPath(pathname)) {
    return { action: "json", status: 401, body: { error: "Unauthorized" } };
  }

  const next = sanitizeNextPath(`${pathname}${search}`);
  return {
    action: "redirect",
    location: `/login?next=${encodeURIComponent(next)}`,
  };
}

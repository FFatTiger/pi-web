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
]);

export function sanitizeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/^[\u0000-\u001f\u007f]/.test(value) || /[\r\n]/.test(value)) return "/";
  const parsed = new URL(value, "http://pi-web.local");
  if (parsed.origin !== "http://pi-web.local") return "/";
  if (parsed.pathname === "/login") return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function isGatePublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function decideGateRequest(config: GateConfig, input: GateRequestInput): GateDecision {
  const { pathname, search } = new URL(input.url);

  if (config.status === "disabled") {
    return { action: "allow", authStatus: "disabled" };
  }

  // Public gate routes always allow so the login page can recover.
  if (isGatePublicPath(pathname)) {
    return { action: "allow", authStatus: "enabled" };
  }

  if (config.status === "unconfigured") {
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

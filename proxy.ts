import { NextRequest, NextResponse } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestOriginAllowed,
  shouldCheckApiRequestOrigin,
} from "@/lib/request-security";
import { readGateConfig } from "@/lib/web-auth-config";
import { decideGateRequest } from "@/lib/web-auth-request";
import { WEB_AUTH_COOKIE } from "@/lib/web-auth-session";

export function proxy(request: NextRequest) {
  // Upstream host/DNS-rebinding and origin protection for API routes first.
  try {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/") && !isApiRequestAllowed(request)) {
      return NextResponse.json(
        { error: "Untrusted API request" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch {
    // Fall through to gate decision on malformed URLs.
  }

  // Browser cross-origin protection also applies to non-API gated pages when
  // origin headers are present (keeps gate from becoming an open side channel).
  if (shouldCheckApiRequestOrigin(request) && !isApiRequestOriginAllowed(request)) {
    const pathname = (() => {
      try {
        return new URL(request.url).pathname;
      } catch {
        return "";
      }
    })();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Cross-origin API requests are not allowed" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const gateConfig = readGateConfig();
  if (gateConfig.status === "error") console.error(gateConfig.logMessage);

  const decision = decideGateRequest(gateConfig, {
    url: request.url,
    method: request.method,
    sessionToken: request.cookies.get(WEB_AUTH_COOKIE)?.value,
  });

  if (decision.action === "redirect") {
    return NextResponse.redirect(new URL(decision.location, request.url));
  }
  if (decision.action === "json") {
    return NextResponse.json(decision.body, {
      status: decision.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const headers = new Headers(request.headers);
  headers.set("x-pi-web-auth-status", decision.authStatus);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    // Protect pages + business APIs/SSE while allowing exact public PWA assets
    // (manifest, sw.js, offline.html, icons/) through.
    "/((?!_next/static|_next/image|favicon\\.ico$|manifest\\.webmanifest$|sw\\.js$|offline\\.html$|icons/).*)",
  ],
};

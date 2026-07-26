import { NextRequest, NextResponse } from "next/server";
import { isApiRequestOriginAllowed, shouldCheckApiRequestOrigin } from "@/lib/request-security";
import { readGateConfig } from "@/lib/web-auth-config";
import { decideGateRequest } from "@/lib/web-auth-request";
import { WEB_AUTH_COOKIE } from "@/lib/web-auth-session";

export function proxy(request: NextRequest) {
  // Upstream cross-origin API protection runs before the password gate so
  // browser cross-site requests never reach auth or business handlers.
  if (shouldCheckApiRequestOrigin(request) && !isApiRequestOriginAllowed(request)) {
    return NextResponse.json(
      { error: "Cross-origin API requests are not allowed" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
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
    // Fork matcher: protect pages + business APIs/SSE while allowing exact
    // public PWA assets (manifest, sw.js, offline.html, icons/) through.
    "/((?!_next/static|_next/image|favicon\\.ico$|manifest\\.webmanifest$|sw\\.js$|offline\\.html$|icons/).*)",
  ],
};

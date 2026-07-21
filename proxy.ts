import { NextRequest, NextResponse } from "next/server";
import { readGateConfig } from "@/lib/web-auth-config";
import { decideGateRequest } from "@/lib/web-auth-request";
import { WEB_AUTH_COOKIE } from "@/lib/web-auth-session";

export function proxy(request: NextRequest) {
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextResponse } from "next/server";
import { WEB_AUTH_COOKIE, getExpiredSessionCookieOptions } from "@/lib/web-auth-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(WEB_AUTH_COOKIE, "", getExpiredSessionCookieOptions(request.url));
  return response;
}

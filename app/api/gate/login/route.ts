import { NextResponse } from "next/server";
import { readGateConfig } from "@/lib/web-auth-config";
import {
  clearLoginFailures,
  getLoginRetryAfterSeconds,
  recordLoginFailure,
} from "@/lib/web-auth-rate-limit";
import { sanitizeNextPath } from "@/lib/web-auth-request";
import {
  WEB_AUTH_COOKIE,
  createSessionToken,
  getSessionCookieOptions,
  passwordsMatch,
} from "@/lib/web-auth-session";
import type { LoginFailureResponse, LoginSuccessResponse } from "@/lib/web-auth-types";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function getClientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

function failure(
  status: number,
  body: LoginFailureResponse,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE, ...headers },
  });
}

function success(body: LoginSuccessResponse) {
  return NextResponse.json(body, { headers: NO_STORE });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(400, { ok: false, error: "请求格式无效" });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return failure(400, { ok: false, error: "请求格式无效" });
  }

  const { password, next } = body as { password?: unknown; next?: unknown };
  if (password !== undefined && typeof password !== "string") {
    return failure(400, { ok: false, error: "请求格式无效" });
  }

  const clientKey = getClientKey(request);
  const nextPath = sanitizeNextPath(typeof next === "string" ? next : undefined);
  const config = readGateConfig();

  if (config.status === "disabled") {
    clearLoginFailures(clientKey);
    return success({ ok: true, next: nextPath });
  }

  if (config.status === "unconfigured") {
    return failure(503, {
      ok: false,
      error: "Authentication is not configured",
      status: "unconfigured",
    });
  }

  if (config.status === "error") {
    console.error(config.logMessage);
    return failure(503, {
      ok: false,
      error: "Authentication configuration error",
      status: "error",
    });
  }

  const retryAfterSeconds = getLoginRetryAfterSeconds(clientKey);
  if (retryAfterSeconds > 0) {
    return failure(
      429,
      {
        ok: false,
        error: "请求过于频繁，请稍后重试",
        retryAfterSeconds,
      },
      { "Retry-After": String(retryAfterSeconds) },
    );
  }

  if (typeof password !== "string" || !passwordsMatch(password, config.password)) {
    recordLoginFailure(clientKey);
    return failure(401, { ok: false, error: "密码不正确" });
  }

  clearLoginFailures(clientKey);
  const response = success({ ok: true, next: nextPath });
  response.cookies.set(
    WEB_AUTH_COOKIE,
    createSessionToken(config.password),
    getSessionCookieOptions(request.url),
  );
  return response;
}

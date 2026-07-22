import { readGateConfig } from "./web-auth-config";
import type { GateConfig } from "./web-auth-types";

export const PUSH_BODY_LIMIT_BYTES = 16 * 1024;

export type EnabledPushRequest = { password: string };

const NO_STORE_JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
} as const;

export function isResponse(value: unknown): value is Response {
  return typeof Response !== "undefined" && value instanceof Response;
}

export function pushJson(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: NO_STORE_JSON_HEADERS,
  });
}

export function pushError(status: number, code: string, error: string): Response {
  return pushJson({ code, error }, { status });
}

export function requireEnabledPushRequest(
  request: Request,
  config: GateConfig = readGateConfig(),
): EnabledPushRequest | Response {
  if (config.status === "unconfigured" || config.status === "error") {
    if (config.status === "error") {
      console.error(config.logMessage);
    }
    return pushError(503, "PUSH_AUTH_CONFIG_ERROR", "Push authentication is not available");
  }

  if (config.status === "disabled") {
    return pushError(403, "PUSH_GATE_REQUIRED", "Push requires an enabled application password gate");
  }

  const authStatus = request.headers.get("x-pi-web-auth-status");
  if (authStatus !== "enabled") {
    return pushError(401, "PUSH_UNAUTHORIZED", "Push request is not authenticated");
  }

  return { password: config.password };
}

function mediaType(contentType: string | null): string | null {
  if (contentType === null) return null;
  return contentType.split(";", 1)[0].trim().toLowerCase();
}

export async function readPushJsonBody(request: Request): Promise<unknown | Response> {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin === null || origin !== requestOrigin) {
    return pushError(403, "PUSH_ORIGIN_MISMATCH", "Push request origin is not allowed");
  }

  if (mediaType(request.headers.get("content-type")) !== "application/json") {
    return pushError(415, "PUSH_JSON_REQUIRED", "Push request must use application/json");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > PUSH_BODY_LIMIT_BYTES)) {
    return pushError(413, "PUSH_BODY_TOO_LARGE", "Push request body is too large");
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > PUSH_BODY_LIMIT_BYTES) {
    return pushError(413, "PUSH_BODY_TOO_LARGE", "Push request body is too large");
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    return pushError(400, "PUSH_INVALID_BODY", "Push request body is invalid");
  }
}

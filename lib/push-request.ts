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

async function cancelBodyBestEffort(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (body === null) return;
  try {
    await body.cancel();
  } catch {
    // best-effort resource hygiene; response already decided
  }
}

async function readBoundedBodyBytes(request: Request): Promise<Uint8Array | Response> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > PUSH_BODY_LIMIT_BYTES)) {
    await cancelBodyBestEffort(request.body);
    return pushError(413, "PUSH_BODY_TOO_LARGE", "Push request body is too large");
  }

  const body = request.body;
  if (body === null) {
    return new Uint8Array(0);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      const remaining = PUSH_BODY_LIMIT_BYTES - total;
      if (value.byteLength > remaining) {
        try {
          await reader.cancel();
        } catch {
          // best-effort cancel; oversize is already decided
        }
        return pushError(413, "PUSH_BODY_TOO_LARGE", "Push request body is too large");
      }

      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // best-effort release after read failure
    }
    return pushError(400, "PUSH_INVALID_BODY", "Push request body is invalid");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // lock may already be released after cancel
    }
  }

  if (total === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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

  const bytesOrError = await readBoundedBodyBytes(request);
  if (isResponse(bytesOrError)) return bytesOrError;

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytesOrError);
    return JSON.parse(text) as unknown;
  } catch {
    return pushError(400, "PUSH_INVALID_BODY", "Push request body is invalid");
  }
}

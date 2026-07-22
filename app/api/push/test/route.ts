import { randomUUID } from "node:crypto";
import {
  isResponse,
  pushError,
  pushJson,
  readPushJsonBody,
  requireEnabledPushRequest,
} from "@/lib/push-request";
import { getPushService, type PushService } from "@/lib/push-service";
import { readGateConfig } from "@/lib/web-auth-config";
import type { GateConfig } from "@/lib/web-auth-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type TestPushResponse = { ok: true; accepted: number };

export type TestDeps = {
  readGateConfig(): GateConfig;
  service: Pick<PushService, "send">;
  createId(): string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function parseBasicEndpoint(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "endpoint") return null;
  const endpoint = value.endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0) return null;
  if (Buffer.byteLength(endpoint, "utf8") > 4096) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  } catch {
    return null;
  }
  return endpoint;
}

function codeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function createTestHandler(deps: TestDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const authenticated = requireEnabledPushRequest(request, deps.readGateConfig());
    if (isResponse(authenticated)) return authenticated;
    const body = await readPushJsonBody(request);
    if (isResponse(body)) return body;
    const endpoint = parseBasicEndpoint(body);
    if (!endpoint) {
      return pushError(400, "PUSH_INVALID_SUBSCRIPTION", "Push subscription is invalid");
    }

    const payload = { version: 1, id: deps.createId(), kind: "test" } as const;
    try {
      const summary = await deps.service.send(payload, authenticated.password, endpoint);
      if (summary.attempted === 0) {
        return pushError(404, "PUSH_SUBSCRIPTION_NOT_FOUND", "Push subscription was not found");
      }
      if (summary.sent === 0) {
        return pushError(502, "PUSH_TEST_FAILED", "Push test could not be delivered");
      }
      return pushJson({ ok: true, accepted: summary.sent } satisfies TestPushResponse);
    } catch (error) {
      const code = codeOf(error);
      if (code === "PUSH_CONFIG_ERROR") {
        return pushError(503, "PUSH_CONFIG_ERROR", "Push configuration is not available");
      }
      if (code === "PUSH_STORE_LOCKED") {
        return pushError(503, "PUSH_STORE_LOCKED", "Push storage is not available");
      }
      return pushError(500, "PUSH_INTERNAL_ERROR", "Push request failed");
    }
  };
}

const handler = createTestHandler({
  readGateConfig,
  service: getPushService(),
  createId: randomUUID,
});

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}

import {
  isResponse,
  pushError,
  pushJson,
  readPushJsonBody,
  requireEnabledPushRequest,
} from "@/lib/push-request";
import {
  getPresenceRegistry,
  type PresenceRegistry,
  type PresenceVisibility,
} from "@/lib/push-presence";
import { computeAuthFingerprint, getPushStore } from "@/lib/push-store";
import { readGateConfig } from "@/lib/web-auth-config";
import type { GateConfig } from "@/lib/web-auth-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type PresenceResponse = { ok: true };

export type PresenceRouteDeps = {
  readGateConfig(): GateConfig;
  getFingerprint(password: string): Promise<string>;
  registry: Pick<PresenceRegistry, "has" | "update">;
};

const MAX_ID_LENGTH = 128;

function codeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function ownKeysEqual(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function parsePresenceBody(value: unknown): {
  connectionId: string;
  visibility: PresenceVisibility;
  ackNotificationId?: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const hasAck = Object.prototype.hasOwnProperty.call(item, "ackNotificationId");
  const expectedKeys = hasAck
    ? ["connectionId", "visibility", "ackNotificationId"]
    : ["connectionId", "visibility"];
  if (!ownKeysEqual(item, expectedKeys)) return null;
  if (!boundedText(item.connectionId, MAX_ID_LENGTH)) return null;
  if (item.visibility !== "visible" && item.visibility !== "hidden") return null;
  if (hasAck && !boundedText(item.ackNotificationId, MAX_ID_LENGTH)) return null;

  return {
    connectionId: item.connectionId,
    visibility: item.visibility,
    ...(hasAck ? { ackNotificationId: item.ackNotificationId as string } : {}),
  };
}

export function createPresenceHandler(deps: PresenceRouteDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const authenticated = requireEnabledPushRequest(request, deps.readGateConfig());
    if (isResponse(authenticated)) return authenticated;

    const body = await readPushJsonBody(request);
    if (isResponse(body)) return body;

    const parsed = parsePresenceBody(body);
    if (!parsed) {
      return pushError(400, "PUSH_INVALID_BODY", "Push request body is invalid");
    }

    let fingerprint: string;
    try {
      fingerprint = await deps.getFingerprint(authenticated.password);
    } catch (error) {
      const code = codeOf(error);
      if (code === "PUSH_STORE_LOCKED") {
        return pushError(503, "PUSH_STORE_LOCKED", "Push storage is not available");
      }
      return pushError(500, "PUSH_INTERNAL_ERROR", "Push request failed");
    }

    if (!deps.registry.has(parsed.connectionId, fingerprint)) {
      return pushError(404, "PUSH_CONNECTION_NOT_FOUND", "Push connection was not found");
    }

    deps.registry.update({
      connectionId: parsed.connectionId,
      authFingerprint: fingerprint,
      visibility: parsed.visibility,
      ...(parsed.ackNotificationId !== undefined
        ? { ackNotificationId: parsed.ackNotificationId }
        : {}),
    });

    return pushJson({ ok: true } satisfies PresenceResponse);
  };
}

async function productionGetFingerprint(password: string): Promise<string> {
  const keys = await getPushStore().getVapidKeys();
  return computeAuthFingerprint(password, keys.privateKey);
}

const handler = createPresenceHandler({
  readGateConfig,
  getFingerprint: productionGetFingerprint,
  registry: getPresenceRegistry(),
});

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}

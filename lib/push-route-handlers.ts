import { parseBasicPushEndpoint } from "./push-endpoint";
import type { PushConfig } from "./push-config";
import {
  isResponse,
  pushError,
  pushJson,
  readPushJsonBody,
  requireEnabledPushRequest,
} from "./push-request";
import type { PresenceRegistry, PresenceVisibility } from "./push-presence";
import type { PushService } from "./push-service";
import type { PushStore } from "./push-store";
import { validatePushSubscription } from "./push-target";
import type { GateConfig } from "./web-auth-types";

export type PushStatusResponse = {
  supported: boolean;
  gateEnabled: boolean;
  configured: boolean;
  publicKeyAvailable: boolean;
  code?: string;
};

export type StatusDeps = {
  readGateConfig(): GateConfig;
  readPushConfig(): PushConfig;
  store: Pick<PushStore, "getPublicKey">;
};

export type VapidPublicKeyResponse = { publicKey: string };

export type PublicKeyDeps = {
  readGateConfig(): GateConfig;
  readPushConfig(): PushConfig;
  store: Pick<PushStore, "getPublicKey">;
};

export type SubscribeResponse = { ok: true; status: "created" | "updated" };
export type UnsubscribeResponse = { ok: true; removed: boolean };

export type SubscribeDeps = {
  readGateConfig(): GateConfig;
  store: Pick<PushStore, "upsert" | "remove">;
};

export type PresenceResponse = { ok: true };

export type PresenceRouteDeps = {
  readGateConfig(): GateConfig;
  getFingerprint(password: string): Promise<string>;
  registry: Pick<PresenceRegistry, "has" | "update">;
};

export type TestPushResponse = { ok: true; accepted: number };

export type TestDeps = {
  readGateConfig(): GateConfig;
  service: Pick<PushService, "send">;
  createId(): string;
};

const MAX_ID_LENGTH = 128;

function codeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function statusBody(
  gateEnabled: boolean,
  configured: boolean,
  publicKeyAvailable: boolean,
  code?: string,
): PushStatusResponse {
  return {
    supported: true,
    gateEnabled,
    configured,
    publicKeyAvailable,
    ...(code ? { code } : {}),
  };
}

function storeError(error: unknown): Response {
  if (codeOf(error) === "PUSH_STORE_LOCKED") {
    return pushError(503, "PUSH_STORE_LOCKED", "Push storage is not available");
  }
  return pushError(500, "PUSH_INTERNAL_ERROR", "Push request failed");
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

export function createStatusHandler(deps: StatusDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const gate = deps.readGateConfig();
    if (gate.status === "disabled") {
      return pushJson(statusBody(false, false, false, "PUSH_GATE_REQUIRED"));
    }
    if (gate.status === "unconfigured" || gate.status === "error") {
      if (gate.status === "error") console.error(gate.logMessage);
      return pushJson(statusBody(false, false, false, "PUSH_AUTH_CONFIG_ERROR"));
    }
    if (request.headers.get("x-pi-web-auth-status") !== "enabled") {
      return pushJson(
        { code: "PUSH_UNAUTHORIZED", error: "Push request is not authenticated" },
        { status: 401 },
      );
    }

    const push = deps.readPushConfig();
    if (push.status !== "enabled") {
      if (push.status === "error") console.error(push.logMessage);
      return pushJson(statusBody(true, false, false, "PUSH_CONFIG_ERROR"));
    }

    try {
      await deps.store.getPublicKey();
      return pushJson(statusBody(true, true, true));
    } catch (error) {
      const code = codeOf(error) === "PUSH_STORE_LOCKED"
        ? "PUSH_STORE_LOCKED"
        : "PUSH_INTERNAL_ERROR";
      return pushJson(statusBody(true, true, false, code));
    }
  };
}

export function createPublicKeyHandler(deps: PublicKeyDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const auth = requireEnabledPushRequest(request, deps.readGateConfig());
    if (isResponse(auth)) return auth;

    const config = deps.readPushConfig();
    if (config.status !== "enabled") {
      if (config.status === "error") console.error(config.logMessage);
      return pushError(503, "PUSH_CONFIG_ERROR", "Push configuration is not available");
    }

    try {
      const publicKey = await deps.store.getPublicKey();
      return pushJson({ publicKey } satisfies VapidPublicKeyResponse);
    } catch (error) {
      if (codeOf(error) === "PUSH_STORE_LOCKED") {
        return pushError(503, "PUSH_STORE_LOCKED", "Push storage is not available");
      }
      return pushError(500, "PUSH_INTERNAL_ERROR", "Push request failed");
    }
  };
}

export function createSubscribeHandlers(deps: SubscribeDeps): {
  POST(request: Request): Promise<Response>;
  DELETE(request: Request): Promise<Response>;
} {
  return {
    async POST(request) {
      const authenticated = requireEnabledPushRequest(request, deps.readGateConfig());
      if (isResponse(authenticated)) return authenticated;
      const body = await readPushJsonBody(request);
      if (isResponse(body)) return body;

      let subscription;
      try {
        subscription = validatePushSubscription(body);
      } catch {
        return pushError(400, "PUSH_INVALID_SUBSCRIPTION", "Push subscription is invalid");
      }

      try {
        const result = await deps.store.upsert(subscription, authenticated.password);
        if (result === "limit") {
          return pushError(409, "PUSH_SUBSCRIPTION_LIMIT", "Push subscription limit reached");
        }
        return pushJson({ ok: true, status: result } satisfies SubscribeResponse);
      } catch (error) {
        return storeError(error);
      }
    },

    async DELETE(request) {
      const authenticated = requireEnabledPushRequest(request, deps.readGateConfig());
      if (isResponse(authenticated)) return authenticated;
      const body = await readPushJsonBody(request);
      if (isResponse(body)) return body;
      const endpoint = parseBasicPushEndpoint(body);
      if (!endpoint) {
        return pushError(400, "PUSH_INVALID_SUBSCRIPTION", "Push subscription is invalid");
      }

      try {
        const removed = await deps.store.remove(endpoint, authenticated.password);
        return pushJson({ ok: true, removed } satisfies UnsubscribeResponse);
      } catch (error) {
        return storeError(error);
      }
    },
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
      if (codeOf(error) === "PUSH_STORE_LOCKED") {
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

export function createTestHandler(deps: TestDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const authenticated = requireEnabledPushRequest(request, deps.readGateConfig());
    if (isResponse(authenticated)) return authenticated;
    const body = await readPushJsonBody(request);
    if (isResponse(body)) return body;
    const endpoint = parseBasicPushEndpoint(body);
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

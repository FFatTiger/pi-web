import { parseBasicPushEndpoint } from "@/lib/push-endpoint";
import {
  isResponse,
  pushError,
  pushJson,
  readPushJsonBody,
  requireEnabledPushRequest,
} from "@/lib/push-request";
import { getPushStore, type PushStore } from "@/lib/push-store";
import { validatePushSubscription } from "@/lib/push-target";
import { readGateConfig } from "@/lib/web-auth-config";
import type { GateConfig } from "@/lib/web-auth-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type SubscribeResponse = { ok: true; status: "created" | "updated" };
export type UnsubscribeResponse = { ok: true; removed: boolean };

export type SubscribeDeps = {
  readGateConfig(): GateConfig;
  store: Pick<PushStore, "upsert" | "remove">;
};

function codeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function storeError(error: unknown): Response {
  if (codeOf(error) === "PUSH_STORE_LOCKED") {
    return pushError(503, "PUSH_STORE_LOCKED", "Push storage is not available");
  }
  return pushError(500, "PUSH_INTERNAL_ERROR", "Push request failed");
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

const handlers = createSubscribeHandlers({
  readGateConfig,
  store: getPushStore(),
});

export async function POST(request: Request): Promise<Response> {
  return handlers.POST(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handlers.DELETE(request);
}

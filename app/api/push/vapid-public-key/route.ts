import { readPushConfig, type PushConfig } from "@/lib/push-config";
import {
  isResponse,
  pushError,
  pushJson,
  requireEnabledPushRequest,
} from "@/lib/push-request";
import { getPushStore, type PushStore } from "@/lib/push-store";
import { readGateConfig } from "@/lib/web-auth-config";
import type { GateConfig } from "@/lib/web-auth-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type VapidPublicKeyResponse = { publicKey: string };

export type PublicKeyDeps = {
  readGateConfig(): GateConfig;
  readPushConfig(): PushConfig;
  store: Pick<PushStore, "getPublicKey">;
};

function codeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
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

const handler = createPublicKeyHandler({
  readGateConfig,
  readPushConfig,
  store: getPushStore(),
});

export async function GET(request: Request): Promise<Response> {
  return handler(request);
}

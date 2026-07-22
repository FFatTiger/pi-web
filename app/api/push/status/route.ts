import { readPushConfig, type PushConfig } from "@/lib/push-config";
import { pushJson } from "@/lib/push-request";
import { getPushStore, type PushStore } from "@/lib/push-store";
import { readGateConfig } from "@/lib/web-auth-config";
import type { GateConfig } from "@/lib/web-auth-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function errorCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
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
      const code = errorCodeOf(error) === "PUSH_STORE_LOCKED"
        ? "PUSH_STORE_LOCKED"
        : "PUSH_INTERNAL_ERROR";
      return pushJson(statusBody(true, true, false, code));
    }
  };
}

const handler = createStatusHandler({
  readGateConfig,
  readPushConfig,
  store: getPushStore(),
});

export async function GET(request: Request): Promise<Response> {
  return handler(request);
}

import { randomBytes } from "node:crypto";
import { readPushConfig } from "@/lib/push-config";
import {
  getPresenceRegistry,
  type PresenceRegistry,
  type PresenceSend,
} from "@/lib/push-presence";
import { computeAuthFingerprint, getPushStore } from "@/lib/push-store";
import type { RunningEventsMessage } from "@/lib/push-types";
import { getRunningRpcSessionIds, subscribeRunningSessions } from "@/lib/rpc-manager";
import { readGateConfig } from "@/lib/web-auth-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type RunningEventsDeps = {
  createConnectionId(): string;
  getAuthFingerprint(): Promise<string | null>;
  registry: Pick<PresenceRegistry, "register" | "unregister">;
  getRunningIds(): string[];
  subscribe(listener: (ids: string[]) => void): () => void;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
};

function createOpaqueConnectionId(): string {
  return randomBytes(16).toString("base64url");
}

export async function productionGetAuthFingerprint(): Promise<string | null> {
  try {
    const push = readPushConfig();
    if (push.status !== "enabled") {
      if (push.status === "error") console.error(push.logMessage);
      return null;
    }

    const gate = readGateConfig();
    if (gate.status !== "enabled") return null;

    const keys = await getPushStore().getVapidKeys();
    return computeAuthFingerprint(gate.password, keys.privateKey);
  } catch {
    return null;
  }
}

export function createRunningEventsHandler(
  deps: RunningEventsDeps,
): (request: Request) => Promise<Response> {
  const setIntervalFn = deps.setInterval ?? setInterval;
  const clearIntervalFn = deps.clearInterval ?? clearInterval;

  return async (request) => {
    const fingerprint = await deps.getAuthFingerprint();
    const connectionId = deps.createConnectionId();

    let cleanup: (() => void) | undefined;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let cleaned = false;

        const encode = (data: RunningEventsMessage | unknown) => {
          const text = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(text));
        };

        const send: PresenceSend = (message) => {
          encode(message);
        };

        let registered = false;
        if (fingerprint) {
          deps.registry.register(connectionId, fingerprint, send);
          registered = true;
        }

        // Connected first so clients learn the opaque connection id before the
        // initial running snapshot.
        encode({ type: "connected", connectionId });

        // Subscribe BEFORE taking the initial snapshot so no state change can slip
        // through the gap between snapshot and subscription.
        const unsubscribe = deps.subscribe((ids) => {
          try {
            encode({ type: "running", runningSessionIds: ids });
          } catch {
            // controller already closed
          }
        });

        // Initial snapshot so the client renders the correct state immediately.
        // (A duplicate frame here is harmless: the client just sets the same set.)
        encode({ type: "running", runningSessionIds: deps.getRunningIds() });

        // Heartbeat to keep the connection alive through proxies/timeouts.
        const heartbeat = setIntervalFn(() => {
          try {
            controller.enqueue(encoder.encode(":\n\n"));
          } catch {
            // controller already closed
          }
        }, 30_000);

        cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          clearIntervalFn(heartbeat);
          unsubscribe();
          if (registered) {
            deps.registry.unregister(connectionId);
          }
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        request.signal?.addEventListener("abort", cleanup);
      },
      cancel() {
        cleanup?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  };
}

const handler = createRunningEventsHandler({
  createConnectionId: createOpaqueConnectionId,
  getAuthFingerprint: productionGetAuthFingerprint,
  registry: getPresenceRegistry(),
  getRunningIds: getRunningRpcSessionIds,
  subscribe: subscribeRunningSessions,
});

// GET /api/agent/running/events - SSE stream of the set of currently-running
// session ids. Pushes an update whenever any session starts or stops working,
// so the sidebar never has to poll. Optionally registers authenticated presence.
export async function GET(req: Request): Promise<Response> {
  return handler(req);
}

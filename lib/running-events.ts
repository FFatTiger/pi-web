import { readPushConfig } from "./push-config";
import {
  getPresenceRegistry,
  type PresenceRegistry,
  type PresenceSend,
} from "./push-presence";
import { computeAuthFingerprint, getPushStore } from "./push-store";
import type { RunningEventsMessage } from "./push-types";
import { readGateConfig } from "./web-auth-config";

export type RunningEventsDeps = {
  createConnectionId(): string;
  getAuthFingerprint(): Promise<string | null>;
  registry: Pick<PresenceRegistry, "register" | "unregister">;
  getRunningIds(): string[];
  subscribe(listener: (ids: string[]) => void): () => void;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
};

export async function getRunningEventsAuthFingerprint(): Promise<string | null> {
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

        encode({ type: "connected", connectionId });

        const unsubscribe = deps.subscribe((ids) => {
          try {
            encode({ type: "running", runningSessionIds: ids });
          } catch {
            // controller already closed
          }
        });

        encode({ type: "running", runningSessionIds: deps.getRunningIds() });

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
          if (registered) deps.registry.unregister(connectionId);
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

export const runningEventsPresenceRegistry = getPresenceRegistry();

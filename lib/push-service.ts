import type { Agent } from "node:https";
import webpush from "web-push";
import { readPushConfig, type PushConfig } from "./push-config";
import { getPushStore, type PushStore } from "./push-store";
import { createPushHttpsAgent, validatePushSubscription } from "./push-target";
import type { NotificationPayloadV1 } from "./push-types";

export type PushDeliveryStatus =
  | "sent"
  | "gone"
  | "auth_error"
  | "temporary"
  | "invalid_target"
  | "error";

export type PushDeliveryResult = { endpointHost: string; status: PushDeliveryStatus };
export type PushSendSummary = {
  attempted: number;
  sent: number;
  results: PushDeliveryResult[];
};

export type PushWebPushClient = {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { TTL: number; timeout: number; agent: Agent },
  ) => Promise<unknown>;
};

export type PushServiceOptions = {
  store?: Pick<PushStore, "getVapidKeys" | "listAuthorized" | "removeEndpoint">;
  client?: PushWebPushClient;
  agent?: Agent;
  readConfig?: () => PushConfig;
};

export class PushConfigError extends Error {
  readonly code = "PUSH_CONFIG_ERROR";

  constructor(message = "Push configuration is invalid") {
    super(message);
    this.name = "PushConfigError";
  }
}

const SEND_TTL_SECONDS = 300;
const SEND_TIMEOUT_MS = 10_000;

type GlobalPushService = typeof globalThis & {
  __piPushService?: PushService;
  __piPushHttpsAgent?: Agent;
};

function getDefaultAgent(): Agent {
  const g = globalThis as GlobalPushService;
  if (!g.__piPushHttpsAgent) {
    g.__piPushHttpsAgent = createPushHttpsAgent();
  }
  return g.__piPushHttpsAgent;
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname || "unknown";
  } catch {
    return "unknown";
  }
}

function statusCodeOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { statusCode?: unknown }).statusCode;
  return typeof code === "number" ? code : undefined;
}

function classifyStatusCode(statusCode: number): PushDeliveryStatus {
  if (statusCode === 404 || statusCode === 410) return "gone";
  if (statusCode === 401 || statusCode === 403) return "auth_error";
  if (statusCode === 429 || statusCode >= 500) return "temporary";
  return "error";
}

export class PushService {
  private readonly store: Pick<PushStore, "getVapidKeys" | "listAuthorized" | "removeEndpoint">;
  private readonly client: PushWebPushClient;
  private readonly agent: Agent;
  private readonly readConfig: () => PushConfig;

  constructor(options?: PushServiceOptions) {
    this.store = options?.store ?? getPushStore();
    this.client = options?.client ?? (webpush as unknown as PushWebPushClient);
    this.agent = options?.agent ?? getDefaultAgent();
    this.readConfig = options?.readConfig ?? readPushConfig;
  }

  async send(
    payload: NotificationPayloadV1,
    password: string,
    endpoint?: string,
  ): Promise<PushSendSummary> {
    const config = this.readConfig();
    if (config.status === "disabled") {
      return { attempted: 0, sent: 0, results: [] };
    }
    if (config.status === "error") {
      console.error(config.logMessage);
      throw new PushConfigError();
    }

    const vapid = await this.store.getVapidKeys();
    this.client.setVapidDetails(config.subject, vapid.publicKey, vapid.privateKey);

    let targets = await this.store.listAuthorized(password);
    if (endpoint !== undefined) {
      targets = targets.filter((item) => item.endpoint === endpoint);
    }

    const results = await Promise.all(
      targets.map(async (record): Promise<PushDeliveryResult> => {
        const host = endpointHost(record.endpoint);
        try {
          let validated;
          try {
            validated = validatePushSubscription({
              endpoint: record.endpoint,
              keys: { p256dh: record.p256dh, auth: record.auth },
            });
          } catch {
            console.error(`push delivery invalid_target host=${host}`);
            return { endpointHost: host, status: "invalid_target" };
          }

          const options = {
            TTL: SEND_TTL_SECONDS,
            timeout: SEND_TIMEOUT_MS,
            agent: this.agent,
          };
          await this.client.sendNotification(
            {
              endpoint: validated.endpoint,
              keys: { p256dh: validated.p256dh, auth: validated.auth },
            },
            JSON.stringify(payload),
            options,
          );
          console.error(`push delivery sent host=${host}`);
          return { endpointHost: host, status: "sent" };
        } catch (error) {
          const statusCode = statusCodeOf(error);
          const status =
            statusCode === undefined ? "error" : classifyStatusCode(statusCode);

          if (status === "gone") {
            try {
              await this.store.removeEndpoint(record.endpoint);
            } catch (removeError) {
              console.error(
                `push delivery cleanup failed host=${host} status=${statusCode ?? "unknown"}`,
              );
              // Still report gone; cleanup failure must not corrupt other sends.
              void removeError;
            }
          }

          console.error(
            `push delivery ${status} host=${host}${statusCode === undefined ? "" : ` status=${statusCode}`}`,
          );
          return { endpointHost: host, status };
        }
      }),
    );

    return {
      attempted: results.length,
      sent: results.filter((item) => item.status === "sent").length,
      results,
    };
  }
}

export function getPushService(): PushService {
  const g = globalThis as GlobalPushService;
  if (!g.__piPushService) {
    g.__piPushService = new PushService();
  }
  return g.__piPushService;
}

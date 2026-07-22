import { randomUUID } from "node:crypto";
import { readPushConfig, type PushConfig } from "./push-config";
import { getPresenceRegistry } from "./push-presence";
import { getPushService } from "./push-service";
import { computeAuthFingerprint, getPushStore } from "./push-store";
import {
  isValidNotificationSessionId,
  type AgentNotificationPayloadV1,
  type AgentNotificationResult,
} from "./push-types";
import { readGateConfig } from "./web-auth-config";
import type { GateConfig } from "./web-auth-types";
import type { SettledCycleSnapshot } from "./settled-cycle";

export type SettledNotificationResult = AgentNotificationResult;

export type PushNotifierOptions = {
  readGateConfig?: () => GateConfig;
  readPushConfig?: () => PushConfig;
  getFingerprint?: (password: string) => Promise<string>;
  presence?: { deliver: (notification: AgentNotificationPayloadV1, fingerprint: string) => Promise<boolean> };
  service?: { send: (payload: AgentNotificationPayloadV1, password: string) => Promise<unknown> };
  createId?: () => string;
  logError?: (message: string) => void;
};

/**
 * Scan backward for the last plain object whose role === "assistant".
 * - none → null
 * - stopReason === "error" → "error"
 * - stopReason === "aborted" → null (no notify)
 * - stop/length/other non-error terminal → "success"
 */
export function classifySettledMessages(messages: unknown[]): SettledNotificationResult | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const msg = item as { role?: unknown; stopReason?: unknown };
    if (msg.role !== "assistant") continue;
    if (msg.stopReason === "error") return "error";
    if (msg.stopReason === "aborted") return null;
    return "success";
  }
  return null;
}

async function defaultGetFingerprint(password: string): Promise<string> {
  const vapid = await getPushStore().getVapidKeys();
  return computeAuthFingerprint(password, vapid.privateKey);
}

export class PushNotifier {
  private readonly readGateConfig: () => GateConfig;
  private readonly readPushConfig: () => PushConfig;
  private readonly getFingerprint: (password: string) => Promise<string>;
  private readonly presence: { deliver: (notification: AgentNotificationPayloadV1, fingerprint: string) => Promise<boolean> };
  private readonly service: { send: (payload: AgentNotificationPayloadV1, password: string) => Promise<unknown> };
  private readonly createId: () => string;
  private readonly logError: (message: string) => void;

  constructor(options: PushNotifierOptions = {}) {
    this.readGateConfig = options.readGateConfig ?? readGateConfig;
    this.readPushConfig = options.readPushConfig ?? readPushConfig;
    this.getFingerprint = options.getFingerprint ?? defaultGetFingerprint;
    this.presence = options.presence ?? getPresenceRegistry();
    this.service = options.service ?? getPushService();
    this.createId = options.createId ?? (() => randomUUID());
    this.logError = options.logError ?? ((message) => console.error(message));
  }

  async handleSettled(snapshot: SettledCycleSnapshot): Promise<void> {
    try {
      await this.handleSettledInner(snapshot);
    } catch {
      this.logError(
        `[pi-web] settled notification failed for ${snapshot.sessionId} cycle ${snapshot.cycleId}`,
      );
    }
  }

  private async handleSettledInner(snapshot: SettledCycleSnapshot): Promise<void> {
    const result = classifySettledMessages(snapshot.messages);
    if (result === null || !isValidNotificationSessionId(snapshot.sessionId)) return;

    const gate = this.readGateConfig();
    if (gate.status !== "enabled") return;

    const pushConfig = this.readPushConfig();
    if (pushConfig.status === "disabled") return;
    if (pushConfig.status === "error") {
      this.logError(pushConfig.logMessage);
      return;
    }

    const fingerprint = await this.getFingerprint(gate.password);
    const payload: AgentNotificationPayloadV1 = {
      version: 1,
      id: this.createId(),
      kind: "agent",
      sessionId: snapshot.sessionId,
      result,
    };

    let acked = false;
    try {
      acked = await this.presence.deliver(payload, fingerprint);
    } catch {
      // Presence failure cannot block fallback to Push. Keep logs generic: a
      // provider error may contain an endpoint or other sensitive details.
      this.logError(
        `[pi-web] presence deliver failed for ${snapshot.sessionId} cycle ${snapshot.cycleId}`,
      );
      acked = false;
    }

    if (acked) return;

    try {
      await this.service.send(payload, gate.password);
    } catch {
      // Push failure must never reject into Agent flow. Keep the provider's
      // exception details out of logs because they can include target data.
      this.logError(
        `[pi-web] push send failed for ${snapshot.sessionId} cycle ${snapshot.cycleId}`,
      );
    }
  }
}

type GlobalPushNotifier = typeof globalThis & {
  __piPushNotifier?: PushNotifier;
};

export function getPushNotifier(): PushNotifier {
  const g = globalThis as GlobalPushNotifier;
  if (!g.__piPushNotifier) {
    g.__piPushNotifier = new PushNotifier();
  }
  return g.__piPushNotifier;
}

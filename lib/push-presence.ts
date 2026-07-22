import type { AgentNotificationPayloadV1, RunningEventsMessage } from "./push-types";

export const PRESENCE_STALE_MS = 35_000;
export const NOTIFICATION_ACK_TIMEOUT_MS = 1_500;

export type PresenceVisibility = "visible" | "hidden";
export type PresenceSend = (message: RunningEventsMessage) => void;

type PresenceRecord = {
  connectionId: string;
  authFingerprint: string;
  visibility: PresenceVisibility;
  lastSeen: number;
  send: PresenceSend;
  pendingAcks: Map<string, () => void>;
};

type PendingDelivery = {
  resolve: (delivered: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  connectionIds: Set<string>;
  settled: boolean;
};

export type PresenceRegistryOptions = {
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

export class PresenceRegistry {
  private readonly connections = new Map<string, PresenceRecord>();
  private readonly pendingDeliveries = new Map<string, PendingDelivery>();
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(options?: PresenceRegistryOptions) {
    this.now = options?.now ?? (() => Date.now());
    this.setTimer = options?.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options?.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  register(connectionId: string, authFingerprint: string, send: PresenceSend): void {
    this.prune();
    if (!connectionId || !authFingerprint) return;
    this.connections.set(connectionId, {
      connectionId,
      authFingerprint,
      visibility: "hidden",
      lastSeen: this.now(),
      send,
      pendingAcks: new Map(),
    });
  }

  unregister(connectionId: string): void {
    const record = this.connections.get(connectionId);
    if (!record) return;
    this.connections.delete(connectionId);
    for (const notificationId of [...record.pendingAcks.keys()]) {
      this.removeConnectionFromDelivery(notificationId, connectionId);
    }
    record.pendingAcks.clear();
  }

  update(input: {
    connectionId: string;
    authFingerprint: string;
    visibility: PresenceVisibility;
    ackNotificationId?: string;
  }): boolean {
    this.prune();
    const record = this.connections.get(input.connectionId);
    if (!record || record.authFingerprint !== input.authFingerprint) {
      return false;
    }

    record.visibility = input.visibility;
    record.lastSeen = this.now();

    const ackId = input.ackNotificationId;
    if (typeof ackId === "string" && ackId.length > 0) {
      const resolveAck = record.pendingAcks.get(ackId);
      if (resolveAck) {
        resolveAck();
      }
    }

    return true;
  }

  has(connectionId: string, authFingerprint: string): boolean {
    this.prune();
    const record = this.connections.get(connectionId);
    return Boolean(record && record.authFingerprint === authFingerprint);
  }

  deliver(notification: AgentNotificationPayloadV1, authFingerprint: string): Promise<boolean> {
    this.prune();
    const now = this.now();
    const candidates = [...this.connections.values()].filter(
      (record) =>
        record.authFingerprint === authFingerprint &&
        record.visibility === "visible" &&
        now - record.lastSeen <= PRESENCE_STALE_MS,
    );

    if (candidates.length === 0) {
      return Promise.resolve(false);
    }

    let settle!: (delivered: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      settle = resolve;
    });

    const delivery: PendingDelivery = {
      resolve: settle,
      timer: this.setTimer(() => {
        this.finishDelivery(notification.id, false);
      }, NOTIFICATION_ACK_TIMEOUT_MS),
      connectionIds: new Set(),
      settled: false,
    };
    this.pendingDeliveries.set(notification.id, delivery);

    const message: RunningEventsMessage = {
      type: "notification",
      notification,
    };

    let sentAny = false;
    for (const record of candidates) {
      const resolveAck = () => {
        this.finishDelivery(notification.id, true);
      };
      record.pendingAcks.set(notification.id, resolveAck);
      delivery.connectionIds.add(record.connectionId);

      try {
        record.send(message);
        sentAny = true;
      } catch {
        record.pendingAcks.delete(notification.id);
        delivery.connectionIds.delete(record.connectionId);
        this.unregister(record.connectionId);
      }
    }

    if (!sentAny) {
      this.finishDelivery(notification.id, false);
    }

    return promise;
  }

  prune(now: number = this.now()): void {
    for (const [connectionId, record] of this.connections) {
      if (now - record.lastSeen > PRESENCE_STALE_MS) {
        this.connections.delete(connectionId);
        for (const notificationId of [...record.pendingAcks.keys()]) {
          this.removeConnectionFromDelivery(notificationId, connectionId);
        }
        record.pendingAcks.clear();
      }
    }
  }

  private removeConnectionFromDelivery(notificationId: string, connectionId: string): void {
    const delivery = this.pendingDeliveries.get(notificationId);
    if (!delivery || delivery.settled) return;
    delivery.connectionIds.delete(connectionId);
    // Pending waiter membership is removed; delivery continues until ACK/timeout
    // unless no successful sends remain (handled at send time).
  }

  private finishDelivery(notificationId: string, delivered: boolean): void {
    const delivery = this.pendingDeliveries.get(notificationId);
    if (!delivery || delivery.settled) return;
    delivery.settled = true;
    this.clearTimer(delivery.timer);
    this.pendingDeliveries.delete(notificationId);

    for (const connectionId of delivery.connectionIds) {
      const record = this.connections.get(connectionId);
      record?.pendingAcks.delete(notificationId);
    }
    delivery.connectionIds.clear();
    delivery.resolve(delivered);
  }
}

type GlobalPresenceRegistry = typeof globalThis & {
  __piPushPresenceRegistry?: PresenceRegistry;
};

export function getPresenceRegistry(): PresenceRegistry {
  const g = globalThis as GlobalPresenceRegistry;
  if (!g.__piPushPresenceRegistry) {
    g.__piPushPresenceRegistry = new PresenceRegistry();
  }
  return g.__piPushPresenceRegistry;
}

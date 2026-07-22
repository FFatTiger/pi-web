"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseNotificationPayload,
  type AgentNotificationPayloadV1,
  type RunningEventsMessage,
} from "@/lib/push-types";

export type AppToastState = AgentNotificationPayloadV1;

export type AppPresenceState = {
  runningSessionIds: ReadonlySet<string>;
  runningAuthoritative: boolean;
  toast: AppToastState | null;
  acknowledgeToast(id: string): Promise<void>;
  dismissToast(id: string): void;
};

const HEARTBEAT_MS = 15_000;
const MAX_CONNECTION_ID_LENGTH = 128;
const MAX_SEEN_NOTIFICATION_IDS = 256;

const boundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function parseRunningEventsMessage(value: unknown): RunningEventsMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;

  if (item.type === "connected") {
    if (!boundedText(item.connectionId, MAX_CONNECTION_ID_LENGTH)) return null;
    return { type: "connected", connectionId: item.connectionId };
  }

  if (item.type === "running") {
    if (!Array.isArray(item.runningSessionIds)) return null;
    if (!item.runningSessionIds.every((id): id is string => typeof id === "string")) return null;
    return {
      type: "running",
      runningSessionIds: dedupeStrings(item.runningSessionIds),
    };
  }

  if (item.type === "notification") {
    const notification = parseNotificationPayload(item.notification);
    if (!notification || notification.kind !== "agent") return null;
    return { type: "notification", notification };
  }

  return null;
}

export function useAppPresence(): AppPresenceState {
  const [runningSessionIds, setRunningSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const [runningAuthoritative, setRunningAuthoritative] = useState(false);
  const [toast, setToast] = useState<AppToastState | null>(null);

  const connectionIdRef = useRef<string | null>(null);
  const toastRef = useRef<AppToastState | null>(null);
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());

  toastRef.current = toast;

  const reportPresence = useCallback(async (ackNotificationId?: string) => {
    const id = connectionIdRef.current;
    if (!id) return;
    try {
      await fetch("/api/push/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: id,
          visibility: document.visibilityState === "visible" ? "visible" : "hidden",
          ...(ackNotificationId ? { ackNotificationId } : {}),
        }),
      });
    } catch {
      // Presence POST failures must not break SSE/running UI.
    }
  }, []);

  const acknowledgeToast = useCallback(async (id: string) => {
    if (toastRef.current?.id !== id) return;
    // Only ACK a toast that is rendered on a visible page.
    if (document.visibilityState !== "visible") return;
    await reportPresence(id);
  }, [reportPresence]);

  const dismissToast = useCallback((id: string) => {
    setToast((current) => (current?.id === id ? null : current));
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/agent/running/events");

    source.onmessage = (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse(event.data) as unknown;
      } catch {
        return;
      }

      const message = parseRunningEventsMessage(raw);
      if (!message) return;

      if (message.type === "connected") {
        connectionIdRef.current = message.connectionId;
        // Immediate presence report on connect / reconnect with the new id.
        void reportPresence();
        return;
      }

      if (message.type === "running") {
        setRunningSessionIds(new Set(message.runningSessionIds));
        setRunningAuthoritative(true);
        return;
      }

      const notificationId = message.notification.id;
      const seen = seenNotificationIdsRef.current;
      if (seen.has(notificationId)) return;
      seen.add(notificationId);
      if (seen.size > MAX_SEEN_NOTIFICATION_IDS) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      // Set toast state only; ACK happens after AppToast commits visible UI.
      setToast(message.notification);
    };

    return () => {
      source.close();
      connectionIdRef.current = null;
    };
  }, [reportPresence]);

  useEffect(() => {
    const onVisibility = () => {
      void reportPresence();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void reportPresence();
    }, HEARTBEAT_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [reportPresence]);

  return {
    runningSessionIds,
    runningAuthoritative,
    toast,
    acknowledgeToast,
    dismissToast,
  };
}

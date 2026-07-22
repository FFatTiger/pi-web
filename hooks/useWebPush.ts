"use client";

import { useCallback, useEffect } from "react";

const PUSH_ENABLED_KEY = "pi-web:push-enabled";
export const AUTO_PROMPT_KEY = "pi-web:push-auto-prompt-v1";

type PushStatusResponse = {
  supported: boolean;
  gateEnabled: boolean;
  configured: boolean;
  publicKeyAvailable: boolean;
  code?: string;
};

type SafeErrorBody = { code?: unknown; error?: unknown };

function browserSupportsPush(): boolean {
  return typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    typeof PushManager !== "undefined" &&
    typeof Notification !== "undefined";
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function serializePushSubscription(subscription: PushSubscription): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const p256dh = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");
  if (!p256dh || !auth) throw new Error("Push subscription keys are unavailable");
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: bytesToBase64url(new Uint8Array(p256dh)),
      auth: bytesToBase64url(new Uint8Array(auth)),
    },
  };
}

/** Pure policy: auto-prompt only when permission is still default and marker is absent. */
export function shouldAttemptAutoPrompt(
  permission: NotificationPermission | "unsupported",
  markerPresent: boolean,
): boolean {
  return permission === "default" && !markerPresent;
}

async function responseError(response: Response): Promise<Error> {
  let body: SafeErrorBody | null = null;
  try {
    body = await response.json() as SafeErrorBody;
  } catch {
    // Fall through to the generic message.
  }
  const message = typeof body?.error === "string"
    ? body.error
    : typeof body?.code === "string"
      ? body.code
      : "Push request failed";
  return new Error(message);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<T>;
}

async function sendJson<T>(url: string, method: "POST" | "DELETE", body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function writeEnabledPreference(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(PUSH_ENABLED_KEY, "1");
    else localStorage.removeItem(PUSH_ENABLED_KEY);
  } catch {
    // Storage is an enhancement; subscription state remains authoritative.
  }
}

function readAutoPromptMarker(): boolean {
  try {
    return localStorage.getItem(AUTO_PROMPT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAutoPromptMarker(): void {
  try {
    localStorage.setItem(AUTO_PROMPT_KEY, "1");
  } catch {
    // Marker write failure still allows a best-effort single request.
  }
}

async function requirePushServer(): Promise<void> {
  const status = await fetchJson<PushStatusResponse>("/api/push/status");
  if (!status.supported || !status.gateEnabled || !status.configured || !status.publicKeyAvailable) {
    throw new Error(status.code ?? "Push is not available");
  }
}

async function getOrCreateSubscription(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  const key = await fetchJson<{ publicKey: string }>("/api/push/vapid-public-key");
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key.publicKey),
  });
}

async function postSubscription(subscription: PushSubscription): Promise<void> {
  await sendJson("/api/push/subscribe", "POST", serializePushSubscription(subscription));
}

async function reconcileGrantedSubscription(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  // Once granted, always create/reuse and post so existing granted users stay reconciled.
  const subscription = await getOrCreateSubscription(registration);
  await postSubscription(subscription);
  writeEnabledPreference(true);
}

/**
 * Headless Web Push reconciler.
 * Attempts permission once when default and marker absent; silent on all failures.
 * AppShell mounts this exactly once and renders no push UI.
 */
export function useWebPush(): void {
  const reconcile = useCallback(async () => {
    if (!browserSupportsPush()) return;

    // Authenticated push server must be available before any permission prompt.
    await requirePushServer();

    let permission = Notification.permission;
    // Keep an explicit Notification.permission === "default" gate in the mount path
    // (policy helper remains the unit-tested decision source for marker/permission combos).
    if (
      Notification.permission === "default" &&
      shouldAttemptAutoPrompt(permission, readAutoPromptMarker())
    ) {
      // Marker MUST be written before requestPermission to survive StrictMode remounts.
      writeAutoPromptMarker();
      try {
        permission = await Notification.requestPermission();
      } catch {
        // Browser gesture suppression / request failures stay silent.
        return;
      }
    }

    if (permission !== "granted") return;

    await reconcileGrantedSubscription();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        await reconcile();
      } catch {
        // Unsupported, denied, default, server-unavailable, and network errors stay silent.
        if (!cancelled) writeEnabledPreference(false);
      }
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) return;
      if (Object.keys(data).length !== 1 || data.type !== "PUSH_SUBSCRIPTION_CHANGED") return;
      void run();
    };

    void run();
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [reconcile]);
}

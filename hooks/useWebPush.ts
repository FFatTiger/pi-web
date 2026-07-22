"use client";

import { useCallback, useEffect, useState } from "react";

const PUSH_ENABLED_KEY = "pi-web:push-enabled";

type PushStatusResponse = {
  supported: boolean;
  gateEnabled: boolean;
  configured: boolean;
  publicKeyAvailable: boolean;
  code?: string;
};

type SafeErrorBody = { code?: unknown; error?: unknown };

export type WebPushState = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  busy: boolean;
  error: string | null;
  enable(): Promise<void>;
  disable(): Promise<void>;
  sendTest(): Promise<void>;
};

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

function readEnabledPreference(): boolean {
  try {
    return localStorage.getItem(PUSH_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabledPreference(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(PUSH_ENABLED_KEY, "1");
    else localStorage.removeItem(PUSH_ENABLED_KEY);
  } catch {
    // Storage is an enhancement; subscription state remains authoritative.
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Push request failed";
}

export function useWebPush(): WebPushState {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reconcile = useCallback(async () => {
    if (!browserSupportsPush()) {
      setSupported(false);
      setPermission("unsupported");
      setSubscribed(false);
      return;
    }

    setSupported(true);
    setPermission(Notification.permission);
    await requirePushServer();
    if (Notification.permission !== "granted") {
      setSubscribed(false);
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription && readEnabledPreference()) {
      subscription = await getOrCreateSubscription(registration);
    }
    if (!subscription) {
      setSubscribed(false);
      return;
    }

    await postSubscription(subscription);
    setSubscribed(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setBusy(true);
      try {
        await reconcile();
        if (!cancelled) setError(null);
      } catch (reason) {
        if (!cancelled) {
          setSubscribed(false);
          setError(errorText(reason));
        }
      } finally {
        if (!cancelled) setBusy(false);
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

  const enable = useCallback(async () => {
    if (!browserSupportsPush()) {
      setError("Push notifications are not supported in this browser");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        throw new Error("Notification permission was not granted");
      }
      await requirePushServer();
      const registration = await navigator.serviceWorker.ready;
      const subscription = await getOrCreateSubscription(registration);
      await postSubscription(subscription);
      writeEnabledPreference(true);
      setSubscribed(true);
    } catch (reason) {
      setError(errorText(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    if (!browserSupportsPush()) return;
    setBusy(true);
    setError(null);
    let endpoint: string | null = null;
    let failure: unknown = null;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      endpoint = subscription?.endpoint ?? null;
      if (subscription) await subscription.unsubscribe();
    } catch (reason) {
      failure = reason;
    } finally {
      if (endpoint) {
        try {
          await sendJson("/api/push/subscribe", "DELETE", { endpoint });
        } catch (reason) {
          failure ??= reason;
        }
      }
      writeEnabledPreference(false);
      setSubscribed(false);
      setBusy(false);
    }
    if (failure) {
      setError(errorText(failure));
      throw failure;
    }
  }, []);

  const sendTest = useCallback(async () => {
    if (!browserSupportsPush()) return;
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) throw new Error("Push subscription is not available");
      await sendJson("/api/push/test", "POST", { endpoint: subscription.endpoint });
    } catch (reason) {
      setError(errorText(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  }, []);

  return { supported, permission, subscribed, busy, error, enable, disable, sendTest };
}

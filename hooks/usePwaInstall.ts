"use client";

import { useCallback, useEffect, useState } from "react";
import { isIosDevice, isStandaloneDisplay } from "@/lib/pwa-lifecycle";

const DISMISS_KEY = "pi-web:pwa-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const matchesStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return isStandaloneDisplay(matchesStandalone, Boolean(nav.standalone));
}

function detectIos(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return isIosDevice(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints ?? 0,
  );
}

export function usePwaInstall(): {
  canInstall: boolean;
  isIos: boolean;
  isStandalone: boolean;
  dismissed: boolean;
  promptInstall(): Promise<void>;
  dismiss(): void;
  resetDismissed(): void;
} {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setIsIos(detectIos());
    setIsStandalone(detectStandalone());
    setDismissed(readDismissed());

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onAppInstalled);

    const mql =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(display-mode: standalone)")
        : null;
    const onDisplayModeChange = () => setIsStandalone(detectStandalone());
    mql?.addEventListener?.("change", onDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
      mql?.removeEventListener?.("change", onDisplayModeChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch {
      // ignore choice resolution errors
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore storage errors
    }
    setDismissed(true);
  }, []);

  const resetDismissed = useCallback(() => {
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      // ignore storage errors
    }
    setDismissed(false);
  }, []);

  return {
    canInstall: deferredPrompt !== null && !isStandalone,
    isIos,
    isStandalone,
    dismissed,
    promptInstall,
    dismiss,
    resetDismissed,
  };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { controllerChangeAction } from "@/lib/pwa-lifecycle";

const UPDATE_CHECK_MS = 60 * 60 * 1000;
/** If SKIP_WAITING never yields controllerchange, return UI to a retryable state. */
const APPLY_TIMEOUT_MS = 8_000;

export function usePwaUpdate(): {
  updateAvailable: boolean;
  activatedElsewhere: boolean;
  applying: boolean;
  applyUpdate(): void;
} {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [activatedElsewhere, setActivatedElsewhere] = useState(false);
  const [applying, setApplying] = useState(false);
  const reloadRequestedRef = useRef(false);
  const waitingRef = useRef<ServiceWorker | null>(null);
  // Snapshot whether this tab already had a controlling SW before the latest
  // controllerchange. First install + clients.claim must not look like an update.
  const hadControllerRef = useRef(false);
  const applyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearApplyTimeout = useCallback(() => {
    if (applyTimeoutRef.current !== null) {
      clearTimeout(applyTimeoutRef.current);
      applyTimeoutRef.current = null;
    }
  }, []);

  const offerWaiting = useCallback((worker: ServiceWorker | null | undefined) => {
    if (!worker) return;
    // Only surface an update when an existing controller is present (not first install).
    if (!navigator.serviceWorker.controller) return;
    waitingRef.current = worker;
    setUpdateAvailable(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    // Keep Next dev / HMR free of a controlling SW.
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    let cancelled = false;
    let updateTimer: ReturnType<typeof setInterval> | null = null;
    let removeUpdateFound: (() => void) | null = null;
    let removeStateChange: (() => void) | null = null;
    let onVisibility: (() => void) | null = null;

    // Record control state before any claim from this registration path.
    hadControllerRef.current = Boolean(navigator.serviceWorker.controller);

    const onControllerChange = () => {
      const hadController = hadControllerRef.current;
      // After any controllerchange the tab now has (or will have) a controller.
      hadControllerRef.current = true;

      const action = controllerChangeAction(reloadRequestedRef.current, hadController);
      if (action === "ignore") {
        clearApplyTimeout();
        setApplying(false);
        return;
      }
      if (action === "reload") {
        clearApplyTimeout();
        window.location.reload();
        return;
      }
      // prompt: another tab activated a waiting worker
      clearApplyTimeout();
      setApplying(false);
      setActivatedElsewhere(true);
      setUpdateAvailable(true);
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((reg) => {
      if (cancelled) return;

      // Re-sync after registration in case a controller already existed.
      if (navigator.serviceWorker.controller) {
        hadControllerRef.current = true;
      }

      // Offer an already-waiting worker only when a controller exists.
      if (reg.waiting && navigator.serviceWorker.controller) {
        offerWaiting(reg.waiting);
      }

      const onUpdateFound = () => {
        const installing = reg.installing;
        if (!installing) return;
        removeStateChange?.();
        const onStateChange = () => {
          if (installing.state === "installed") {
            offerWaiting(installing);
          }
        };
        installing.addEventListener("statechange", onStateChange);
        removeStateChange = () => installing.removeEventListener("statechange", onStateChange);
        // Race fix: worker may already be installed by the time we attach.
        onStateChange();
      };

      reg.addEventListener("updatefound", onUpdateFound);
      removeUpdateFound = () => reg.removeEventListener("updatefound", onUpdateFound);

      const checkForUpdate = () => {
        void reg.update().catch(() => {
          // Network errors during update checks are non-fatal.
        });
      };

      onVisibility = () => {
        if (document.visibilityState === "visible") checkForUpdate();
      };
      document.addEventListener("visibilitychange", onVisibility);
      updateTimer = setInterval(checkForUpdate, UPDATE_CHECK_MS);
    }).catch(() => {
      // Registration can fail offline or in unsupported contexts; leave UI quiet.
    });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      removeUpdateFound?.();
      removeStateChange?.();
      if (updateTimer) clearInterval(updateTimer);
      if (onVisibility) {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      clearApplyTimeout();
    };
  }, [clearApplyTimeout, offerWaiting]);

  const applyUpdate = useCallback(() => {
    if (activatedElsewhere) {
      window.location.reload();
      return;
    }
    const waiting = waitingRef.current;
    if (!waiting) return;
    reloadRequestedRef.current = true;
    setApplying(true);
    clearApplyTimeout();
    applyTimeoutRef.current = setTimeout(() => {
      // Activation never completed: stay tab-local, keep updateAvailable, allow retry.
      reloadRequestedRef.current = false;
      setApplying(false);
      applyTimeoutRef.current = null;
    }, APPLY_TIMEOUT_MS);
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [activatedElsewhere, clearApplyTimeout]);

  return {
    updateAvailable,
    activatedElsewhere,
    applying,
    applyUpdate,
  };
}

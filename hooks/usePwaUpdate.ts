"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { controllerChangeAction } from "@/lib/pwa-lifecycle";

const UPDATE_CHECK_MS = 60 * 60 * 1000;

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

    let cancelled = false;
    let updateTimer: ReturnType<typeof setInterval> | null = null;
    let removeUpdateFound: (() => void) | null = null;
    let removeStateChange: (() => void) | null = null;
    let onVisibility: (() => void) | null = null;

    const onControllerChange = () => {
      const action = controllerChangeAction(reloadRequestedRef.current);
      if (action === "reload") {
        window.location.reload();
      } else {
        setActivatedElsewhere(true);
        setUpdateAvailable(true);
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((reg) => {
        if (cancelled) return;

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
      })
      .catch(() => {
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
    };
  }, [offerWaiting]);

  const applyUpdate = useCallback(() => {
    if (activatedElsewhere) {
      window.location.reload();
      return;
    }
    const waiting = waitingRef.current;
    if (!waiting) return;
    reloadRequestedRef.current = true;
    setApplying(true);
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [activatedElsewhere]);

  return {
    updateAvailable,
    activatedElsewhere,
    applying,
    applyUpdate,
  };
}

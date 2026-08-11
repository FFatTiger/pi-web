import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { HttpError } from "../errors.js";

export interface FileWatchManager {
  open(filePath: string, signal?: AbortSignal): Response;
  activeCount(): number;
  reservedCount(): number;
  closeAll(): void;
}

export function createFileWatchManager(maxWatchers = 32): FileWatchManager {
  if (!Number.isInteger(maxWatchers) || maxWatchers < 1) throw new Error("maxWatchers must be positive");
  const reservations = new Map<string, () => void>();
  const activeCleanups = new Set<() => void>();
  const encoder = new TextEncoder();

  return {
    open(filePath, signal) {
      if (activeCleanups.size + reservations.size >= maxWatchers) {
        throw new HttpError(429, "WATCH_LIMIT", "File watch limit reached");
      }
      const reservationId = randomUUID();
      let watcher: FSWatcher | undefined;
      let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
      let finished = false;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        reservations.delete(reservationId);
        activeCleanups.delete(cleanup);
        signal?.removeEventListener("abort", onAbort);
        if (watcher) {
          watcher.close();
          watcher = undefined;
        }
      };
      const closeStream = () => {
        cleanup();
        try { controllerRef?.close(); } catch { /* already closed */ }
      };
      const onAbort = () => closeStream();
      // Reserve synchronously before stat() or any other asynchronous work.
      reservations.set(reservationId, cleanup);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controllerRef = controller;
          if (finished) { controller.close(); return; }
          const send = (event: string, value: unknown) => {
            if (finished) return;
            if (controller.desiredSize !== null && controller.desiredSize <= 0) {
              closeStream();
              return;
            }
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
          };
          try {
            const initial = await stat(filePath);
            if (finished) return;
            let previousMtime = initial.mtimeMs;
            let previousSize = initial.size;
            watcher = watch(filePath, async () => {
              try {
                const current = await stat(filePath);
                if (current.mtimeMs === previousMtime && current.size === previousSize) return;
                previousMtime = current.mtimeMs;
                previousSize = current.size;
                send("change", { modified: current.mtime.toISOString(), size: current.size });
              } catch { send("change", { removed: true }); }
            });
            if (finished) { watcher.close(); watcher = undefined; return; }
            reservations.delete(reservationId);
            activeCleanups.add(cleanup);
            watcher.once("error", closeStream);
            send("connected", { path: filePath, size: initial.size });
          } catch (error) {
            cleanup();
            controller.error(error);
          }
        },
        cancel() { cleanup(); },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
    },
    activeCount: () => activeCleanups.size,
    reservedCount: () => reservations.size,
    closeAll() {
      for (const cleanup of [...reservations.values()]) cleanup();
      for (const cleanup of [...activeCleanups]) cleanup();
    },
  };
}

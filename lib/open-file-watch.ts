import { encodeFilePathForApi, normalizeFilePathSlashes } from "@/lib/file-paths";

export type OpenFileWatchEvent =
  | { type: "connected" }
  | { type: "change"; size?: number }
  | { type: "error" };

type OpenFileWatchListener = (event: OpenFileWatchEvent) => void;

type WatchEntry = {
  source: EventSource;
  listeners: Set<OpenFileWatchListener>;
};

const watches = new Map<string, WatchEntry>();

function watchKey(filePath: string, sourceSessionId?: string | null): string {
  return `${sourceSessionId ?? ""}::${normalizeFilePathSlashes(filePath)}`;
}

function watchUrl(filePath: string, sourceSessionId?: string | null): string {
  const encoded = encodeFilePathForApi(filePath);
  const params = new URLSearchParams({ type: "watch" });
  if (sourceSessionId) params.set("sessionId", sourceSessionId);
  return `/api/files/${encoded}?${params.toString()}`;
}

/**
 * Session-level (process-level) open-file watch fanout.
 * Multiple FileViewer mounts for the same path share one EventSource.
 */
export function subscribeOpenFileWatch(
  filePath: string,
  sourceSessionId: string | null | undefined,
  listener: OpenFileWatchListener,
): () => void {
  const key = watchKey(filePath, sourceSessionId);
  let entry = watches.get(key);

  if (!entry) {
    const source = new EventSource(watchUrl(filePath, sourceSessionId));
    entry = { source, listeners: new Set() };
    watches.set(key, entry);

    source.addEventListener("connected", () => {
      for (const fn of entry!.listeners) fn({ type: "connected" });
    });
    source.addEventListener("change", (event) => {
      let size: number | undefined;
      try {
        const data = JSON.parse((event as MessageEvent).data) as { size?: number };
        if (typeof data.size === "number") size = data.size;
      } catch {
        /* ignore */
      }
      for (const fn of entry!.listeners) fn({ type: "change", size });
    });
    source.addEventListener("error", () => {
      for (const fn of entry!.listeners) fn({ type: "error" });
    });
    source.onerror = () => {
      for (const fn of entry!.listeners) fn({ type: "error" });
    };
  }

  entry.listeners.add(listener);

  // Late subscribers still learn current connection state.
  if (entry.source.readyState === EventSource.OPEN) {
    listener({ type: "connected" });
  }

  return () => {
    const current = watches.get(key);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    current.source.close();
    watches.delete(key);
  };
}

/** Test helper */
export function getOpenFileWatchCountForTests(): number {
  return watches.size;
}

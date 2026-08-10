import { useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  buildTranscriptRows,
  createDemoTranscriptMessages,
  estimateRowHeight,
  getTranscriptRowKey,
  type TranscriptRow,
} from "./row-model";
import { useCapabilities } from "@/features/capability/CapabilityProvider";

export interface TranscriptListProps {
  sessionId?: string;
  /** Optional external rows; defaults to demo adapter. */
  rows?: TranscriptRow[];
  overscan?: number;
}

export function TranscriptList({
  sessionId,
  rows: rowsProp,
  overscan = 8,
}: TranscriptListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { isReadonly } = useCapabilities();

  const rows = useMemo(() => {
    if (rowsProp) return rowsProp;
    const messages = createDemoTranscriptMessages(sessionId);
    return buildTranscriptRows(messages, { readonlyBanner: isReadonly });
  }, [rowsProp, sessionId, isReadonly]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => estimateRowHeight(rows[index]!),
    overscan,
    getItemKey: (index) => getTranscriptRowKey(rows[index]!),
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="transcript-scroll"
      role="log"
      aria-label="Conversation transcript"
      aria-relevant="additions"
    >
      <div
        className="transcript-inner"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((item) => {
          const row = rows[item.index]!;
          return (
            <div
              key={item.key}
              data-index={item.index}
              data-row-id={row.id}
              ref={virtualizer.measureElement}
              className={`transcript-row transcript-row--${row.kind}`}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
            >
              <TranscriptRowView row={row} />
            </div>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <div className="transcript-empty">No messages</div>
      ) : null}
    </div>
  );
}

function TranscriptRowView({ row }: { row: TranscriptRow }) {
  const label =
    row.kind === "tool" && row.meta?.toolName
      ? row.meta.toolName
      : row.kind;

  return (
    <article className="transcript-row-card">
      <header className="transcript-row-meta">
        <span className="transcript-row-kind">{label}</span>
      </header>
      <div className="transcript-row-body">{row.text}</div>
    </article>
  );
}

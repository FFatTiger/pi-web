/**
 * Transcript row model — pure data shape, independent of view/virtualizer.
 * Virtualization consumes this model; view components map row → UI.
 */

export type TranscriptRowKind =
  | "user"
  | "assistant"
  | "tool"
  | "system"
  | "divider";

export interface TranscriptRow {
  /** Stable identity for virtualizer keys (never index). */
  id: string;
  kind: TranscriptRowKind;
  /** Plain text body for shell preview / a11y. */
  text: string;
  /** Optional estimated height hint; virtualizer still measures dynamically. */
  estimateHeight?: number;
  meta?: {
    createdAt?: string;
    toolName?: string;
  };
}

export interface BuildRowsOptions {
  /** When true, inject a readonly banner row at the top. */
  readonlyBanner?: boolean;
}

const DEFAULT_ESTIMATE: Record<TranscriptRowKind, number> = {
  user: 72,
  assistant: 96,
  tool: 56,
  system: 40,
  divider: 28,
};

export function estimateRowHeight(row: TranscriptRow): number {
  if (typeof row.estimateHeight === "number" && row.estimateHeight > 0) {
    return row.estimateHeight;
  }
  // Rough text-based estimate so first paint is closer before measure.
  const lines = Math.max(1, Math.ceil(row.text.length / 72));
  const base = DEFAULT_ESTIMATE[row.kind];
  return Math.min(480, base + Math.max(0, lines - 1) * 18);
}

export function buildTranscriptRows(
  messages: readonly TranscriptMessageInput[],
  options: BuildRowsOptions = {},
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];

  if (options.readonlyBanner) {
    rows.push({
      id: "row:system:readonly",
      kind: "system",
      text: "Read-only mode — host has no agent capability. Browsing history only.",
      estimateHeight: 40,
    });
  }

  for (const message of messages) {
    rows.push({
      id: message.id,
      kind: message.role,
      text: message.text,
      estimateHeight: message.estimateHeight,
      meta: {
        createdAt: message.createdAt,
        toolName: message.toolName,
      },
    });
  }

  return rows;
}

export interface TranscriptMessageInput {
  id: string;
  role: Exclude<TranscriptRowKind, "divider" | "system"> | "system";
  text: string;
  createdAt?: string;
  toolName?: string;
  estimateHeight?: number;
}

/** Local demo adapter — empty host until sessions protocol lands. */
export function createDemoTranscriptMessages(
  sessionId: string | undefined,
): TranscriptMessageInput[] {
  if (!sessionId) {
    return [
      {
        id: "demo:welcome",
        role: "system",
        text: "Select a session from the sidebar or open a deep link with ?session=…",
      },
    ];
  }

  return [
    {
      id: `demo:${sessionId}:1`,
      role: "user",
      text: `Session ${sessionId} — demo user message (local adapter, not host data).`,
    },
    {
      id: `demo:${sessionId}:2`,
      role: "assistant",
      text: "This shell uses TanStack Virtual with dynamic measure, stable keys, and overscan. Real transcript rows will attach via protocol later.",
    },
    {
      id: `demo:${sessionId}:3`,
      role: "tool",
      text: "tool:read_file → packages/client/src/main.tsx",
      toolName: "read_file",
    },
    {
      id: `demo:${sessionId}:4`,
      role: "assistant",
      text: Array.from({ length: 8 }, (_, i) =>
        `Paragraph ${i + 1}: placeholder content to exercise variable row heights in the virtualizer.`,
      ).join("\n\n"),
    },
  ];
}

/** Stable key extractor for virtualizer. */
export function getTranscriptRowKey(row: TranscriptRow): string {
  return row.id;
}

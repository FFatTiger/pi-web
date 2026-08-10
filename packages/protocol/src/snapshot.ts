import { z } from "zod";
import {
  ContextUsageSchema,
  ExtensionStatusItemSchema,
  ExtensionWidgetItemSchema,
  ModelRefSchema,
  NonEmptyStringSchema,
  QueuedMessagesSchema,
  ThinkingLevelSchema,
  WorkerStatusSchema,
} from "./common.js";
import { AgentMessageSchema } from "./messages.js";

/**
 * Live runtime state projection embedded in snapshots.
 * No SDK AgentSession / Model / Event objects.
 */
export const RuntimeStateSchema = z.object({
  sessionId: NonEmptyStringSchema,
  sessionFile: z.string().optional(),
  isStreaming: z.boolean(),
  isPromptRunning: z.boolean(),
  isBashRunning: z.boolean(),
  isCompacting: z.boolean(),
  autoCompactionEnabled: z.boolean().optional(),
  autoRetryEnabled: z.boolean().optional(),
  model: ModelRefSchema.optional().nullable(),
  messageCount: z.number().int().nonnegative().optional(),
  pendingMessageCount: z.number().int().nonnegative().optional(),
  queuedMessages: QueuedMessagesSchema.optional(),
  contextUsage: ContextUsageSchema.nullable().optional(),
  systemPrompt: z.string().optional(),
  thinkingLevel: ThinkingLevelSchema.optional(),
  extensionStatuses: z.array(ExtensionStatusItemSchema).optional(),
  extensionWidgets: z.array(ExtensionWidgetItemSchema).optional(),
  sessionName: z.string().optional(),
});

export type RuntimeState = z.infer<typeof RuntimeStateSchema>;

/**
 * In-flight streaming projection for reconnect UIs.
 * Messages here are normalized DTOs only.
 */
export const StreamingProjectionSchema = z.object({
  active: z.boolean(),
  partialMessage: AgentMessageSchema.or(
    z.object({
      role: z.enum([
        "user",
        "assistant",
        "toolResult",
        "custom",
        "bashExecution",
      ]),
      content: z.unknown().optional(),
    }),
  ).optional(),
  toolCallIds: z.array(z.string()).optional(),
  phase: z
    .enum([
      "idle",
      "waiting_model",
      "streaming",
      "running_tools",
      "compacting",
      "retrying",
    ])
    .optional(),
});

export type StreamingProjection = z.infer<typeof StreamingProjectionSchema>;

/**
 * Full runtime snapshot pushed on attach / resume.
 * Clients apply snapshot then continue from lastEventId.
 */
export const RuntimeSnapshotSchema = z.object({
  sessionId: NonEmptyStringSchema,
  epoch: z.number().int().nonnegative(),
  lastEventId: NonEmptyStringSchema,
  workerStatus: WorkerStatusSchema,
  state: RuntimeStateSchema,
  streaming: StreamingProjectionSchema.optional(),
  /** Optional recent messages for cold attach (not a full history dump). */
  messages: z.array(AgentMessageSchema).optional(),
});

export type RuntimeSnapshot = z.infer<typeof RuntimeSnapshotSchema>;

export function parseRuntimeSnapshot(input: unknown): RuntimeSnapshot {
  return RuntimeSnapshotSchema.parse(input);
}

export function safeParseRuntimeSnapshot(input: unknown) {
  return RuntimeSnapshotSchema.safeParse(input);
}

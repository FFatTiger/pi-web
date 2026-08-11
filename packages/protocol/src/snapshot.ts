import { z } from "zod";
import {
  ContextUsageSchema,
  EpochSchema,
  ExtensionStatusItemSchema,
  ExtensionWidgetItemSchema,
  ExtensionWidgetPlacementSchema,
  LastEventIdSchema,
  ModelRefSchema,
  NonEmptyStringSchema,
  QueuedMessagesSchema,
  ThinkingLevelSchema,
  ToolInfoSchema,
  WorkerStatusSchema,
} from "./common.js";
import {
  AgentMessageSchema,
  StreamingAgentMessageSchema,
} from "./messages.js";

/**
 * Pending extension UI request projection (subset of extension_ui_request fields).
 * Full event validation lives in events.ts; snapshot only needs client-replay fields.
 */
export const PendingExtensionUiSchema = z.strictObject({
  id: NonEmptyStringSchema,
  method: z.enum([
    "select",
    "confirm",
    "input",
    "editor",
    "notify",
    "setStatus",
    "setWidget",
    "setTitle",
    "set_editor_text",
    "custom",
  ]),
  title: z.string().optional(),
  message: z.string().optional(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  prefill: z.string().optional(),
  notifyType: z.enum(["info", "warning", "error"]).optional(),
  statusKey: NonEmptyStringSchema.optional(),
  statusText: z.string().optional(),
  widgetKey: NonEmptyStringSchema.optional(),
  widgetLines: z.array(z.string()).optional(),
  widgetPlacement: ExtensionWidgetPlacementSchema.optional(),
  text: z.string().optional(),
  lines: z.array(z.string()).optional(),
  closed: z.boolean().optional(),
  timeout: z.number().optional(),
  expiresAt: z.number().optional(),
});

export type PendingExtensionUi = z.infer<typeof PendingExtensionUiSchema>;

/**
 * Live runtime state projection embedded in snapshots.
 * No SDK AgentSession / Model / Event objects.
 */
export const RuntimeStateSchema = z.strictObject({
  sessionId: NonEmptyStringSchema,
  sessionFile: z.string().optional(),
  isStreaming: z.boolean(),
  isPromptRunning: z.boolean(),
  isBashRunning: z.boolean(),
  isCompacting: z.boolean(),
  autoCompactionEnabled: z.boolean().optional(),
  autoRetryEnabled: z.boolean().optional(),
  model: ModelRefSchema.nullable().optional(),
  messageCount: z.number().int().nonnegative().optional(),
  pendingMessageCount: z.number().int().nonnegative().optional(),
  queuedMessages: QueuedMessagesSchema.optional(),
  contextUsage: ContextUsageSchema.nullable().optional(),
  systemPrompt: z.string().optional(),
  thinkingLevel: ThinkingLevelSchema.optional(),
  tools: z.array(ToolInfoSchema).optional(),
  extensionStatuses: z.array(ExtensionStatusItemSchema).optional(),
  extensionWidgets: z.array(ExtensionWidgetItemSchema).optional(),
  pendingExtensionUi: z.array(PendingExtensionUiSchema).optional(),
  sessionName: z.string().optional(),
});

export type RuntimeState = z.infer<typeof RuntimeStateSchema>;

/**
 * In-flight streaming projection for reconnect UIs.
 * Messages here are role-discriminated streaming DTOs only.
 */
export const StreamingProjectionSchema = z.strictObject({
  active: z.boolean(),
  partialMessage: StreamingAgentMessageSchema.optional(),
  toolCallIds: z.array(z.string()).optional(),
  phase: z
    .enum([
      "idle",
      "waiting_model",
      "streaming",
      "running_tools",
      "compacting",
      "bash",
      "retrying",
    ])
    .optional(),
});

export type StreamingProjection = z.infer<typeof StreamingProjectionSchema>;

/**
 * Full runtime snapshot pushed on attach / resume.
 * Clients apply snapshot then continue from lastEventId.
 * lastEventId is a nonnegative safe integer (0 = no events yet).
 * epoch is a non-blank string token.
 */
export const RuntimeSnapshotSchema = z.strictObject({
  sessionId: NonEmptyStringSchema,
  epoch: EpochSchema,
  lastEventId: LastEventIdSchema,
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

import { z } from "zod";
import {
  ContextUsageSchema,
  ExtensionStatusItemSchema,
  ExtensionWidgetItemSchema,
  ExtensionWidgetPlacementSchema,
  ModelRefSchema,
  NonEmptyStringSchema,
  ThinkingLevelSchema,
  ToolInfoSchema,
} from "./common.js";
import {
  QueuedMessagesSchema,
  RuntimeCapabilitySetSchema,
} from "./domain.js";
import {
  AgentMessageSchema,
  StreamingAgentMessageSchema,
} from "./messages.js";

/** Pending extension UI request projection for reconnect/replay. */
export const PendingExtensionUiSchema = z
  .strictObject({
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
    timeout: z.number().nonnegative().optional(),
    expiresAt: z.number().optional(),
  })
  .superRefine((value, ctx) => {
    const requireField = (field: keyof typeof value) => {
      if (value[field] === undefined) {
        ctx.addIssue({ code: "custom", path: [field], message: `${field} is required for ${value.method}` });
      }
    };
    switch (value.method) {
      case "select": requireField("title"); requireField("options"); break;
      case "confirm": requireField("title"); requireField("message"); break;
      case "input":
      case "editor":
      case "setTitle": requireField("title"); break;
      case "notify": requireField("message"); requireField("notifyType"); break;
      case "setStatus": requireField("statusKey"); break;
      case "setWidget": requireField("widgetKey"); break;
      case "set_editor_text": requireField("text"); break;
      case "custom": requireField("lines"); break;
    }
  });
export type PendingExtensionUi = z.infer<typeof PendingExtensionUiSchema>;

export const BashProjectionSchema = z.strictObject({
  command: z.string(),
  output: z.string(),
  excludeFromContext: z.boolean(),
  truncated: z.boolean(),
  cancelled: z.boolean(),
  completed: z.boolean(),
  exitCode: z.number().int().optional(),
  fullOutputPath: z.string().optional(),
  updateCount: z.number().int().nonnegative().safe(),
});
export type BashProjection = z.infer<typeof BashProjectionSchema>;

export const CompactionProjectionSchema = z.strictObject({
  reason: z.enum(["manual", "auto"]),
  status: z.enum(["running", "aborting"]),
  customInstructions: z.string().optional(),
  startedAt: z.number(),
});
export type CompactionProjection = z.infer<typeof CompactionProjectionSchema>;

/** Product runtime state; transport cursors live on RuntimeSnapshot. */
export const RuntimeStateSchema = z.strictObject({
  sessionId: NonEmptyStringSchema,
  sessionFile: z.string().optional(),
  leafId: NonEmptyStringSchema.optional(),
  isStreaming: z.boolean(),
  isPromptRunning: z.boolean(),
  isBashRunning: z.boolean(),
  isCompacting: z.boolean(),
  bash: BashProjectionSchema.optional(),
  compaction: CompactionProjectionSchema.optional(),
  autoCompactionEnabled: z.boolean().optional(),
  autoRetryEnabled: z.boolean().optional(),
  model: ModelRefSchema.nullable(),
  messageCount: z.number().int().nonnegative(),
  pendingMessageCount: z.number().int().nonnegative().optional(),
  queuedMessages: QueuedMessagesSchema.optional(),
  contextUsage: ContextUsageSchema.nullable().optional(),
  systemPrompt: z.string().optional(),
  thinkingLevel: ThinkingLevelSchema.optional(),
  thinkingLevelPinned: z.boolean().optional(),
  tools: z.array(ToolInfoSchema).optional(),
  extensionStatuses: z.array(ExtensionStatusItemSchema).optional(),
  extensionWidgets: z.array(ExtensionWidgetItemSchema).optional(),
  pendingExtensionUi: z.array(PendingExtensionUiSchema).optional(),
  sessionName: z.string().optional(),
  writtenFiles: z.array(z.string()).optional(),
});
export type RuntimeState = z.infer<typeof RuntimeStateSchema>;

export const StreamingProjectionSchema = z.strictObject({
  active: z.boolean(),
  partialMessage: StreamingAgentMessageSchema.optional(),
  toolCallIds: z.array(NonEmptyStringSchema).optional(),
  phase: z.enum([
    "idle",
    "waiting_model",
    "streaming",
    "running_tools",
    "compacting",
    "bash",
    "retrying",
  ]).optional(),
});
export type StreamingProjection = z.infer<typeof StreamingProjectionSchema>;

/** Runtime Core semantic projection before sessiond adds epoch/event cursor. */
export const RuntimeSnapshotSchema = z.strictObject({
  sessionId: NonEmptyStringSchema,
  state: RuntimeStateSchema,
  capabilities: RuntimeCapabilitySetSchema,
  streaming: StreamingProjectionSchema.optional(),
  messages: z.array(AgentMessageSchema).optional(),
});
export type RuntimeSnapshot = z.infer<typeof RuntimeSnapshotSchema>;

export function parseRuntimeSnapshot(input: unknown): RuntimeSnapshot {
  return RuntimeSnapshotSchema.parse(input);
}

export function safeParseRuntimeSnapshot(input: unknown) {
  return RuntimeSnapshotSchema.safeParse(input);
}

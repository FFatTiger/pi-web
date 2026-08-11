import { z } from "zod";
import {
  EpochSchema,
  EventIdSchema,
  ExtensionStatusItemSchema,
  ExtensionWidgetItemSchema,
  ExtensionWidgetPlacementSchema,
  NonEmptyStringSchema,
  ProtocolErrorSchema,
} from "./common.js";
import {
  AgentMessageSchema,
  StreamingAgentMessageSchema,
} from "./messages.js";

/**
 * Envelope fields shared by every normalized runtime event.
 * `eventId` is a positive safe integer, monotonic per (sessionId, epoch).
 * `epoch` is a non-blank string token.
 */
const eventBase = {
  eventId: EventIdSchema,
  sessionId: NonEmptyStringSchema,
  epoch: EpochSchema,
  ts: z.number().int().nonnegative().optional(),
};

export const AgentStartEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("agent_start"),
});

export const AgentEndEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("agent_end"),
});

export const AgentSettledEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("agent_settled"),
});

export const MessageStartEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("message_start"),
  message: StreamingAgentMessageSchema,
});

export const MessageUpdateEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("message_update"),
  message: StreamingAgentMessageSchema,
});

/** message_end carries a complete AgentMessage only. */
export const MessageEndEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("message_end"),
  message: AgentMessageSchema,
});

export const ToolExecutionStartEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("tool_execution_start"),
  toolCallId: NonEmptyStringSchema,
  toolName: NonEmptyStringSchema,
  args: z.unknown().optional(),
});

export const ToolExecutionUpdateEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("tool_execution_update"),
  toolCallId: NonEmptyStringSchema,
  toolName: z.string().optional(),
  partialResult: z.unknown().optional(),
});

export const ToolExecutionEndEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("tool_execution_end"),
  toolCallId: NonEmptyStringSchema,
  toolName: z.string().optional(),
  isError: z.boolean().optional(),
  result: z.unknown().optional(),
});

export const TurnStartEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("turn_start"),
});

export const TurnEndEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("turn_end"),
});

export const PromptDoneEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("prompt_done"),
});

export const PromptErrorEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("prompt_error"),
  errorMessage: z.string(),
});

export const QueueUpdateEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("queue_update"),
  steering: z.array(z.string()).optional(),
  followUp: z.array(z.string()).optional(),
});

export const AutoRetryStartEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("auto_retry_start"),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  errorMessage: z.string().optional(),
});

export const AutoRetryEndEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("auto_retry_end"),
  success: z.boolean().optional(),
});

export const CompactionStartEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("compaction_start"),
});

export const CompactionEndEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("compaction_end"),
  aborted: z.boolean().optional(),
  errorMessage: z.string().optional(),
  reason: z.string().optional(),
  result: z.unknown().optional(),
});

export const AutoCompactionStartEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("auto_compaction_start"),
});

export const AutoCompactionEndEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("auto_compaction_end"),
  aborted: z.boolean().optional(),
  errorMessage: z.string().optional(),
  reason: z.string().optional(),
  result: z.unknown().optional(),
});

export const ExtensionErrorEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("extension_error"),
  error: z.string(),
  details: z.unknown().optional(),
});

/**
 * extension_ui_request is one RuntimeEvent type; method is nested discrimination.
 * Implemented as a single strict-ish object with method-specific required fields
 * validated via superRefine so the top-level RuntimeEvent can stay a
 * discriminatedUnion("type", ...).
 */
const extensionUiMethods = [
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
] as const;

export const ExtensionUiRequestMethodSchema = z.enum(extensionUiMethods);
export type ExtensionUiRequestMethod = z.infer<
  typeof ExtensionUiRequestMethodSchema
>;

export const ExtensionUiRequestEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("extension_ui_request"),
    id: NonEmptyStringSchema,
    method: ExtensionUiRequestMethodSchema,
    timeout: z.number().optional(),
    expiresAt: z.number().optional(),
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
  })
  .strict()
  .superRefine((value, ctx) => {
    const require = (field: keyof typeof value, label = String(field)) => {
      if (value[field] === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `${label} is required for method ${value.method}`,
          path: [field],
        });
      }
    };
    switch (value.method) {
      case "select":
        require("title");
        require("options");
        break;
      case "confirm":
        require("title");
        require("message");
        break;
      case "input":
        require("title");
        break;
      case "editor":
        require("title");
        break;
      case "notify":
        require("message");
        break;
      case "setStatus":
        require("statusKey");
        break;
      case "setWidget":
        require("widgetKey");
        break;
      case "setTitle":
        require("title");
        break;
      case "set_editor_text":
        require("text");
        break;
      case "custom":
        require("lines");
        break;
    }
  });

export type ExtensionUiRequestEvent = z.infer<
  typeof ExtensionUiRequestEventSchema
>;

export const ExtensionStatusesEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("extension_statuses"),
  statuses: z.array(ExtensionStatusItemSchema),
});

export const ExtensionWidgetsEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("extension_widgets"),
  widgets: z.array(ExtensionWidgetItemSchema),
});

export const SessionTitleEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("session_title"),
  name: z.string(),
});

export const RuntimeErrorEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("runtime_error"),
  error: ProtocolErrorSchema,
});

/**
 * Normalized RuntimeEvent union (top-level type discrimination).
 * SDK Event types must not leak; adapters project SDK events into these shapes.
 */
export const RuntimeEventSchema = z.discriminatedUnion("type", [
  AgentStartEventSchema,
  AgentEndEventSchema,
  AgentSettledEventSchema,
  MessageStartEventSchema,
  MessageUpdateEventSchema,
  MessageEndEventSchema,
  ToolExecutionStartEventSchema,
  ToolExecutionUpdateEventSchema,
  ToolExecutionEndEventSchema,
  TurnStartEventSchema,
  TurnEndEventSchema,
  PromptDoneEventSchema,
  PromptErrorEventSchema,
  QueueUpdateEventSchema,
  AutoRetryStartEventSchema,
  AutoRetryEndEventSchema,
  CompactionStartEventSchema,
  CompactionEndEventSchema,
  AutoCompactionStartEventSchema,
  AutoCompactionEndEventSchema,
  ExtensionErrorEventSchema,
  ExtensionUiRequestEventSchema,
  ExtensionStatusesEventSchema,
  ExtensionWidgetsEventSchema,
  SessionTitleEventSchema,
  RuntimeErrorEventSchema,
]);

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

export function parseRuntimeEvent(input: unknown): RuntimeEvent {
  return RuntimeEventSchema.parse(input);
}

export function safeParseRuntimeEvent(input: unknown) {
  return RuntimeEventSchema.safeParse(input);
}

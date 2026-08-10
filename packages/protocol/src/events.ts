import { z } from "zod";
import {
  ExtensionStatusItemSchema,
  ExtensionWidgetItemSchema,
  ExtensionWidgetPlacementSchema,
  NonEmptyStringSchema,
  ProtocolErrorSchema,
} from "./common.js";
import {
  AgentMessageSchema,
  PartialAgentMessageSchema,
} from "./messages.js";

/**
 * Envelope fields shared by every normalized runtime event.
 * `eventId` is monotonic per (sessionId, epoch) for resume.
 */
const eventBase = {
  eventId: NonEmptyStringSchema,
  sessionId: NonEmptyStringSchema,
  epoch: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative().optional(),
};

export const AgentStartEventSchema = z.object({
  ...eventBase,
  type: z.literal("agent_start"),
});

export const AgentEndEventSchema = z.object({
  ...eventBase,
  type: z.literal("agent_end"),
});

export const AgentSettledEventSchema = z.object({
  ...eventBase,
  type: z.literal("agent_settled"),
});

export const MessageStartEventSchema = z.object({
  ...eventBase,
  type: z.literal("message_start"),
  message: PartialAgentMessageSchema.or(AgentMessageSchema),
});

export const MessageUpdateEventSchema = z.object({
  ...eventBase,
  type: z.literal("message_update"),
  message: PartialAgentMessageSchema.or(AgentMessageSchema),
});

export const MessageEndEventSchema = z.object({
  ...eventBase,
  type: z.literal("message_end"),
  message: AgentMessageSchema.or(PartialAgentMessageSchema),
});

export const ToolExecutionStartEventSchema = z.object({
  ...eventBase,
  type: z.literal("tool_execution_start"),
  toolCallId: NonEmptyStringSchema,
  toolName: NonEmptyStringSchema,
  args: z.unknown().optional(),
});

export const ToolExecutionUpdateEventSchema = z.object({
  ...eventBase,
  type: z.literal("tool_execution_update"),
  toolCallId: NonEmptyStringSchema,
  toolName: z.string().optional(),
  partialResult: z.unknown().optional(),
});

export const ToolExecutionEndEventSchema = z.object({
  ...eventBase,
  type: z.literal("tool_execution_end"),
  toolCallId: NonEmptyStringSchema,
  toolName: z.string().optional(),
  isError: z.boolean().optional(),
  result: z.unknown().optional(),
});

export const TurnStartEventSchema = z.object({
  ...eventBase,
  type: z.literal("turn_start"),
});

export const TurnEndEventSchema = z.object({
  ...eventBase,
  type: z.literal("turn_end"),
});

export const PromptDoneEventSchema = z.object({
  ...eventBase,
  type: z.literal("prompt_done"),
});

export const PromptErrorEventSchema = z.object({
  ...eventBase,
  type: z.literal("prompt_error"),
  errorMessage: z.string(),
});

export const QueueUpdateEventSchema = z.object({
  ...eventBase,
  type: z.literal("queue_update"),
  steering: z.array(z.string()).optional(),
  followUp: z.array(z.string()).optional(),
});

export const AutoRetryStartEventSchema = z.object({
  ...eventBase,
  type: z.literal("auto_retry_start"),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  errorMessage: z.string().optional(),
});

export const AutoRetryEndEventSchema = z.object({
  ...eventBase,
  type: z.literal("auto_retry_end"),
  success: z.boolean().optional(),
});

export const CompactionStartEventSchema = z.object({
  ...eventBase,
  type: z.literal("compaction_start"),
});

export const CompactionEndEventSchema = z.object({
  ...eventBase,
  type: z.literal("compaction_end"),
  aborted: z.boolean().optional(),
  errorMessage: z.string().optional(),
  reason: z.string().optional(),
  result: z.unknown().optional(),
});

export const AutoCompactionStartEventSchema = z.object({
  ...eventBase,
  type: z.literal("auto_compaction_start"),
});

export const AutoCompactionEndEventSchema = z.object({
  ...eventBase,
  type: z.literal("auto_compaction_end"),
  aborted: z.boolean().optional(),
  errorMessage: z.string().optional(),
  reason: z.string().optional(),
  result: z.unknown().optional(),
});

export const ExtensionErrorEventSchema = z.object({
  ...eventBase,
  type: z.literal("extension_error"),
  error: z.string(),
  details: z.unknown().optional(),
});

const extensionUiRequestBase = {
  ...eventBase,
  type: z.literal("extension_ui_request") as z.ZodLiteral<"extension_ui_request">,
  id: NonEmptyStringSchema,
  timeout: z.number().optional(),
  expiresAt: z.number().optional(),
};

export const ExtensionUiSelectRequestSchema = z.object({
  ...extensionUiRequestBase,
  method: z.literal("select"),
  title: z.string(),
  options: z.array(z.string()),
});

export const ExtensionUiConfirmRequestSchema = z.object({
  ...extensionUiRequestBase,
  method: z.literal("confirm"),
  title: z.string(),
  message: z.string(),
});

export const ExtensionUiInputRequestSchema = z.object({
  ...extensionUiRequestBase,
  method: z.literal("input"),
  title: z.string(),
  placeholder: z.string().optional(),
});

export const ExtensionUiEditorRequestSchema = z.object({
  ...extensionUiRequestBase,
  method: z.literal("editor"),
  title: z.string(),
  prefill: z.string().optional(),
});

export const ExtensionUiNotifyRequestSchema = z.object({
  ...extensionUiRequestBase,
  method: z.literal("notify"),
  message: z.string(),
  notifyType: z.enum(["info", "warning", "error"]).optional(),
});

export const ExtensionUiSetStatusRequestSchema = z.object({
  ...extensionUiRequestBase,
  method: z.literal("setStatus"),
  statusKey: NonEmptyStringSchema,
  statusText: z.string().optional(),
});

export const ExtensionUiSetWidgetRequestSchema = z.object({
  ...extensionUiRequestBase,
  method: z.literal("setWidget"),
  widgetKey: NonEmptyStringSchema,
  widgetLines: z.array(z.string()).optional(),
  widgetPlacement: ExtensionWidgetPlacementSchema.optional(),
});

export const ExtensionUiSetTitleRequestSchema = z.object({
  ...extensionUiRequestBase,
  method: z.literal("setTitle"),
  title: z.string(),
});

export const ExtensionUiSetEditorTextRequestSchema = z.object({
  ...extensionUiRequestBase,
  method: z.literal("set_editor_text"),
  text: z.string(),
});

export const ExtensionUiCustomRequestSchema = z.object({
  ...extensionUiRequestBase,
  method: z.literal("custom"),
  lines: z.array(z.string()),
  closed: z.boolean().optional(),
});

export const ExtensionUiRequestEventSchema = z.discriminatedUnion("method", [
  ExtensionUiSelectRequestSchema,
  ExtensionUiConfirmRequestSchema,
  ExtensionUiInputRequestSchema,
  ExtensionUiEditorRequestSchema,
  ExtensionUiNotifyRequestSchema,
  ExtensionUiSetStatusRequestSchema,
  ExtensionUiSetWidgetRequestSchema,
  ExtensionUiSetTitleRequestSchema,
  ExtensionUiSetEditorTextRequestSchema,
  ExtensionUiCustomRequestSchema,
]);

export type ExtensionUiRequestEvent = z.infer<
  typeof ExtensionUiRequestEventSchema
>;

export const ExtensionStatusesEventSchema = z.object({
  ...eventBase,
  type: z.literal("extension_statuses"),
  statuses: z.array(ExtensionStatusItemSchema),
});

export const ExtensionWidgetsEventSchema = z.object({
  ...eventBase,
  type: z.literal("extension_widgets"),
  widgets: z.array(ExtensionWidgetItemSchema),
});

export const SessionTitleEventSchema = z.object({
  ...eventBase,
  type: z.literal("session_title"),
  name: z.string(),
});

export const RuntimeErrorEventSchema = z.object({
  ...eventBase,
  type: z.literal("runtime_error"),
  error: ProtocolErrorSchema,
});

/**
 * Normalized RuntimeEvent union.
 * SDK Event types must not leak; adapters project SDK events into these shapes.
 */
export const RuntimeEventSchema = z.union([
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

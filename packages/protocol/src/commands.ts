import { z } from "zod";
import {
  ImageAttachmentSchema,
  NonEmptyStringSchema,
  StreamingBehaviorSchema,
  ThinkingLevelSchema,
} from "./common.js";

/**
 * Every runtime command carries `commandId` for at-most-once delivery.
 * Clients must mint unique commandIds; host/sessiond dedupe by (sessionId, commandId).
 */
const commandBase = {
  commandId: NonEmptyStringSchema,
};

export const PromptCommandSchema = z.object({
  ...commandBase,
  type: z.literal("prompt"),
  message: z.string(),
  images: z.array(ImageAttachmentSchema).optional(),
  streamingBehavior: StreamingBehaviorSchema.optional(),
});

export const AbortCommandSchema = z.object({
  ...commandBase,
  type: z.literal("abort"),
});

export const GetStateCommandSchema = z.object({
  ...commandBase,
  type: z.literal("get_state"),
});

export const SetModelCommandSchema = z.object({
  ...commandBase,
  type: z.literal("set_model"),
  provider: NonEmptyStringSchema,
  modelId: NonEmptyStringSchema,
});

export const ForkCommandSchema = z.object({
  ...commandBase,
  type: z.literal("fork"),
  entryId: NonEmptyStringSchema,
});

export const NavigateTreeCommandSchema = z.object({
  ...commandBase,
  type: z.literal("navigate_tree"),
  targetId: NonEmptyStringSchema,
});

export const SetThinkingLevelCommandSchema = z.object({
  ...commandBase,
  type: z.literal("set_thinking_level"),
  level: ThinkingLevelSchema,
});

export const CompactCommandSchema = z.object({
  ...commandBase,
  type: z.literal("compact"),
  customInstructions: z.string().optional(),
});

export const SetSessionNameCommandSchema = z.object({
  ...commandBase,
  type: z.literal("set_session_name"),
  name: NonEmptyStringSchema,
});

export const GetSessionStatsCommandSchema = z.object({
  ...commandBase,
  type: z.literal("get_session_stats"),
});

export const GetLastAssistantTextCommandSchema = z.object({
  ...commandBase,
  type: z.literal("get_last_assistant_text"),
});

export const SetAutoCompactionCommandSchema = z.object({
  ...commandBase,
  type: z.literal("set_auto_compaction"),
  enabled: z.boolean(),
});

export const ClearQueueCommandSchema = z.object({
  ...commandBase,
  type: z.literal("clear_queue"),
});

export const SteerCommandSchema = z.object({
  ...commandBase,
  type: z.literal("steer"),
  message: z.string(),
  images: z.array(ImageAttachmentSchema).optional(),
});

export const FollowUpCommandSchema = z.object({
  ...commandBase,
  type: z.literal("follow_up"),
  message: z.string(),
  images: z.array(ImageAttachmentSchema).optional(),
});

export const GetToolsCommandSchema = z.object({
  ...commandBase,
  type: z.literal("get_tools"),
});

export const GetCommandsCommandSchema = z.object({
  ...commandBase,
  type: z.literal("get_commands"),
});

export const SetToolsCommandSchema = z.object({
  ...commandBase,
  type: z.literal("set_tools"),
  toolNames: z.array(z.string()),
  includeExtensionTools: z.boolean().optional(),
});

export const ReloadCommandSchema = z.object({
  ...commandBase,
  type: z.literal("reload"),
});

export const AbortCompactionCommandSchema = z.object({
  ...commandBase,
  type: z.literal("abort_compaction"),
});

/**
 * Extension UI responses — value/confirmed/cancelled variants share type.
 * Payload details beyond id use z.unknown()-friendly optional fields.
 */
export const ExtensionUiResponseCommandSchema = z.object({
  ...commandBase,
  type: z.literal("extension_ui_response"),
  id: NonEmptyStringSchema,
  value: z.string().optional(),
  confirmed: z.boolean().optional(),
  cancelled: z.literal(true).optional(),
});

export const ExtensionUiInputCommandSchema = z.object({
  ...commandBase,
  type: z.literal("extension_ui_input"),
  id: NonEmptyStringSchema,
  data: z.string(),
});

export const SetAutoRetryCommandSchema = z.object({
  ...commandBase,
  type: z.literal("set_auto_retry"),
  enabled: z.boolean(),
});

export const BashCommandSchema = z.object({
  ...commandBase,
  type: z.literal("bash"),
  command: z.string(),
  excludeFromContext: z.boolean().optional(),
});

export const AbortBashCommandSchema = z.object({
  ...commandBase,
  type: z.literal("abort_bash"),
});

/**
 * Generate a session title from conversation content (26th command; was HTTP-only).
 */
export const GenerateSessionTitleCommandSchema = z.object({
  ...commandBase,
  type: z.literal("generate_session_title"),
});

/**
 * Discriminated union of all 26 RuntimeCommand variants.
 * Existing 25 RPC commands + generate_session_title.
 */
export const RuntimeCommandSchema = z.discriminatedUnion("type", [
  PromptCommandSchema,
  AbortCommandSchema,
  GetStateCommandSchema,
  SetModelCommandSchema,
  ForkCommandSchema,
  NavigateTreeCommandSchema,
  SetThinkingLevelCommandSchema,
  CompactCommandSchema,
  SetSessionNameCommandSchema,
  GetSessionStatsCommandSchema,
  GetLastAssistantTextCommandSchema,
  SetAutoCompactionCommandSchema,
  ClearQueueCommandSchema,
  SteerCommandSchema,
  FollowUpCommandSchema,
  GetToolsCommandSchema,
  GetCommandsCommandSchema,
  SetToolsCommandSchema,
  ReloadCommandSchema,
  AbortCompactionCommandSchema,
  ExtensionUiResponseCommandSchema,
  ExtensionUiInputCommandSchema,
  SetAutoRetryCommandSchema,
  BashCommandSchema,
  AbortBashCommandSchema,
  GenerateSessionTitleCommandSchema,
]);

export type RuntimeCommand = z.infer<typeof RuntimeCommandSchema>;

export const RUNTIME_COMMAND_TYPES = [
  "prompt",
  "abort",
  "get_state",
  "set_model",
  "fork",
  "navigate_tree",
  "set_thinking_level",
  "compact",
  "set_session_name",
  "get_session_stats",
  "get_last_assistant_text",
  "set_auto_compaction",
  "clear_queue",
  "steer",
  "follow_up",
  "get_tools",
  "get_commands",
  "set_tools",
  "reload",
  "abort_compaction",
  "extension_ui_response",
  "extension_ui_input",
  "set_auto_retry",
  "bash",
  "abort_bash",
  "generate_session_title",
] as const;

export type RuntimeCommandType = (typeof RUNTIME_COMMAND_TYPES)[number];

export function parseRuntimeCommand(input: unknown): RuntimeCommand {
  return RuntimeCommandSchema.parse(input);
}

export function safeParseRuntimeCommand(input: unknown) {
  return RuntimeCommandSchema.safeParse(input);
}

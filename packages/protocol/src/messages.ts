import { z } from "zod";
import { ModelRefSchema, NonEmptyStringSchema } from "./common.js";

/** Message content blocks — normalized DTOs, no SDK content types. */

export const TextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export type TextContent = z.infer<typeof TextContentSchema>;

export const ImageContentSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("base64"),
    media_type: z.string().min(1),
    data: z.string().min(1),
  }),
  z.object({
    type: z.literal("url"),
    url: z.string().min(1),
    media_type: z.string().optional(),
  }),
]);

export type ImageContentSource = z.infer<typeof ImageContentSourceSchema>;

export const ImageContentSchema = z.object({
  type: z.literal("image"),
  source: ImageContentSourceSchema,
});

export type ImageContent = z.infer<typeof ImageContentSchema>;

export const ThinkingContentSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  deferred: z.boolean().optional(),
});

export type ThinkingContent = z.infer<typeof ThinkingContentSchema>;

/**
 * Tool call args are intentionally `z.unknown()` — tool schemas vary and
 * must not pull SDK tool parameter types into the protocol.
 */
export const ToolCallContentSchema = z.object({
  type: z.literal("toolCall"),
  toolCallId: NonEmptyStringSchema,
  toolName: NonEmptyStringSchema,
  input: z.unknown(),
});

export type ToolCallContent = z.infer<typeof ToolCallContentSchema>;

export const AssistantContentBlockSchema = z.discriminatedUnion("type", [
  TextContentSchema,
  ImageContentSchema,
  ThinkingContentSchema,
  ToolCallContentSchema,
]);

export type AssistantContentBlock = z.infer<typeof AssistantContentBlockSchema>;

export const UserContentSchema = z.union([
  z.string(),
  z.array(z.union([TextContentSchema, ImageContentSchema])),
]);

export type UserContent = z.infer<typeof UserContentSchema>;

export const TokenUsageCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  total: z.number(),
});

export const TokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  cost: TokenUsageCostSchema,
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const UserMessageSchema = z.object({
  role: z.literal("user"),
  content: UserContentSchema,
  timestamp: z.number().optional(),
});

export type UserMessage = z.infer<typeof UserMessageSchema>;

export const AssistantMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.array(AssistantContentBlockSchema),
  model: z.string(),
  provider: z.string(),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
  timestamp: z.number().optional(),
  usage: TokenUsageSchema.optional(),
});

export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

export const ToolResultMessageSchema = z.object({
  role: z.literal("toolResult"),
  toolCallId: NonEmptyStringSchema,
  toolName: z.string().optional(),
  content: z.array(z.union([TextContentSchema, ImageContentSchema])),
  isError: z.boolean().optional(),
  details: z.unknown().optional(),
  timestamp: z.number().optional(),
});

export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>;

export const CustomMessageSchema = z.object({
  role: z.literal("custom"),
  customType: NonEmptyStringSchema,
  content: UserContentSchema,
  display: z.boolean(),
  details: z.unknown().optional(),
  timestamp: z.number().optional(),
});

export type CustomMessage = z.infer<typeof CustomMessageSchema>;

export const BashExecutionMessageSchema = z.object({
  role: z.literal("bashExecution"),
  command: z.string(),
  output: z.string(),
  exitCode: z.number().optional(),
  cancelled: z.boolean().optional(),
  truncated: z.boolean().optional(),
  fullOutputPath: z.string().optional(),
  excludeFromContext: z.boolean().optional(),
  timestamp: z.number().optional(),
});

export type BashExecutionMessage = z.infer<typeof BashExecutionMessageSchema>;

export const AgentMessageSchema = z.discriminatedUnion("role", [
  UserMessageSchema,
  AssistantMessageSchema,
  ToolResultMessageSchema,
  CustomMessageSchema,
  BashExecutionMessageSchema,
]);

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

/** Partial assistant/user message used during streaming updates. */
export const PartialAgentMessageSchema = z.object({
  role: z.enum(["user", "assistant", "toolResult", "custom", "bashExecution"]),
  content: z.unknown().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  isError: z.boolean().optional(),
  details: z.unknown().optional(),
  customType: z.string().optional(),
  display: z.boolean().optional(),
  command: z.string().optional(),
  output: z.string().optional(),
  exitCode: z.number().optional(),
  cancelled: z.boolean().optional(),
  truncated: z.boolean().optional(),
  fullOutputPath: z.string().optional(),
  excludeFromContext: z.boolean().optional(),
  timestamp: z.number().optional(),
  usage: TokenUsageSchema.optional(),
});

export type PartialAgentMessage = z.infer<typeof PartialAgentMessageSchema>;

export const ModelChangeSchema = ModelRefSchema;

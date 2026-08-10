import { z } from "zod";

/** Opaque non-empty string id (commandId, eventId, sessionId, requestId, …). */
export const NonEmptyStringSchema = z.string().min(1);

export const IsoTimestampSchema = z.string().min(1);

/**
 * Structured protocol error codes.
 * Transport/adapters map local failures into these codes; never leak SDK Error classes.
 */
export const ProtocolErrorCodeSchema = z.enum([
  "protocol_mismatch",
  "invalid_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "epoch_changed",
  "gap",
  "runtime_unavailable",
  "worker_unavailable",
  "session_busy",
  "command_rejected",
  "command_duplicate",
  "unsupported_capability",
  "timeout",
  "internal",
]);

export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCodeSchema>;

export const ProtocolErrorSchema = z.object({
  code: ProtocolErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
  retryable: z.boolean().optional(),
});

export type ProtocolError = z.infer<typeof ProtocolErrorSchema>;

/** Thinking / reasoning levels used by the runtime (no SDK ThinkingLevel type). */
export const ThinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

/** Normalized model identity — id + provider only; no SDK Model object. */
export const ModelRefSchema = z.object({
  id: NonEmptyStringSchema,
  provider: NonEmptyStringSchema,
});

export type ModelRef = z.infer<typeof ModelRefSchema>;

export const ContextUsageSchema = z.object({
  percent: z.number(),
  contextWindow: z.number().optional(),
  tokens: z.number().optional(),
});

export type ContextUsage = z.infer<typeof ContextUsageSchema>;

/**
 * Image attachment on prompt/steer/follow_up.
 * Protocol shape uses type:"image" + base64 data + mimeType (image/*).
 */
export const ImageAttachmentSchema = z.object({
  type: z.literal("image"),
  data: z.string().min(1),
  mimeType: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("image/"), {
      message: "mimeType must start with image/",
    }),
});

export type ImageAttachment = z.infer<typeof ImageAttachmentSchema>;

export const StreamingBehaviorSchema = z.enum(["steer", "followUp"]);

export type StreamingBehavior = z.infer<typeof StreamingBehaviorSchema>;

export const WorkerStatusSchema = z.enum([
  "idle",
  "starting",
  "ready",
  "busy",
  "stopping",
  "stopped",
  "crashed",
  "unavailable",
]);

export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

export const ExtensionStatusItemSchema = z.object({
  key: NonEmptyStringSchema,
  text: z.string(),
});

export type ExtensionStatusItem = z.infer<typeof ExtensionStatusItemSchema>;

export const ExtensionWidgetPlacementSchema = z.enum([
  "aboveEditor",
  "belowEditor",
]);

export type ExtensionWidgetPlacement = z.infer<
  typeof ExtensionWidgetPlacementSchema
>;

export const ExtensionWidgetItemSchema = z.object({
  key: NonEmptyStringSchema,
  lines: z.array(z.string()),
  placement: ExtensionWidgetPlacementSchema,
});

export type ExtensionWidgetItem = z.infer<typeof ExtensionWidgetItemSchema>;

export const QueuedMessagesSchema = z.object({
  steering: z.array(z.string()),
  followUp: z.array(z.string()),
});

export type QueuedMessages = z.infer<typeof QueuedMessagesSchema>;

export const ToolInfoSchema = z.object({
  name: NonEmptyStringSchema,
  description: z.string().optional(),
  active: z.boolean(),
});

export type ToolInfo = z.infer<typeof ToolInfoSchema>;

export const SlashCommandSourceSchema = z.enum([
  "extension",
  "prompt",
  "skill",
]);

export type SlashCommandSource = z.infer<typeof SlashCommandSourceSchema>;

export const SlashCommandInfoSchema = z.object({
  name: NonEmptyStringSchema,
  description: z.string().optional(),
  source: SlashCommandSourceSchema,
  sourceInfo: z.unknown().optional(),
});

export type SlashCommandInfo = z.infer<typeof SlashCommandInfoSchema>;

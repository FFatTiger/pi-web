import { z } from "zod";
import { RuntimeCommandSchema } from "./commands.js";
import {
  NonEmptyStringSchema,
  ProtocolErrorSchema,
  ThinkingLevelSchema,
  WorkerStatusSchema,
} from "./common.js";
import { RuntimeEventSchema } from "./events.js";
import { RuntimeStateSchema } from "./snapshot.js";
import { ProtocolVersionSchema } from "./version.js";

/**
 * sessiond ↔ agent-worker IPC envelope.
 * Worker process only speaks this protocol + pi SDK internally.
 * No React/Next/FS imports and no SDK types on the wire.
 */

export const WorkerControlMethodSchema = z.enum([
  "init",
  "command",
  "get_state",
  "shutdown",
  "ping",
  "abort",
]);

export type WorkerControlMethod = z.infer<typeof WorkerControlMethodSchema>;

export const WorkerInitParamsSchema = z.object({
  sessionId: NonEmptyStringSchema,
  cwd: NonEmptyStringSchema,
  sessionFile: z.string().optional(),
  model: z
    .object({
      provider: NonEmptyStringSchema,
      modelId: NonEmptyStringSchema,
    })
    .optional(),
  thinkingLevel: ThinkingLevelSchema.optional(),
  toolNames: z.array(z.string()).optional(),
  includeExtensionTools: z.boolean().optional(),
  /** Opaque worker bootstrap options (paths, env flags) — not SDK objects. */
  options: z.unknown().optional(),
});

export type WorkerInitParams = z.infer<typeof WorkerInitParamsSchema>;

export const WorkerIpcRequestSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  id: NonEmptyStringSchema,
  method: WorkerControlMethodSchema,
  params: z.unknown().optional(),
});

export type WorkerIpcRequest = z.infer<typeof WorkerIpcRequestSchema>;

export const WorkerIpcSuccessSchema = z.object({
  id: NonEmptyStringSchema,
  ok: z.literal(true),
  result: z.unknown().optional(),
});

export const WorkerIpcFailureSchema = z.object({
  id: NonEmptyStringSchema,
  ok: z.literal(false),
  error: ProtocolErrorSchema,
});

export const WorkerIpcResponseSchema = z.discriminatedUnion("ok", [
  WorkerIpcSuccessSchema,
  WorkerIpcFailureSchema,
]);

export type WorkerIpcResponse = z.infer<typeof WorkerIpcResponseSchema>;

/** Worker → sessiond event push. */
export const WorkerEventMessageSchema = z.object({
  type: z.literal("event"),
  sessionId: NonEmptyStringSchema,
  event: RuntimeEventSchema,
});

export const WorkerStatusMessageSchema = z.object({
  type: z.literal("status"),
  sessionId: NonEmptyStringSchema,
  status: WorkerStatusSchema,
  detail: z.string().optional(),
});

export const WorkerStateMessageSchema = z.object({
  type: z.literal("state"),
  sessionId: NonEmptyStringSchema,
  state: RuntimeStateSchema,
});

export const WorkerPushSchema = z.discriminatedUnion("type", [
  WorkerEventMessageSchema,
  WorkerStatusMessageSchema,
  WorkerStateMessageSchema,
]);

export type WorkerPush = z.infer<typeof WorkerPushSchema>;

export const WorkerCommandParamsSchema = z.object({
  command: RuntimeCommandSchema,
});

export type WorkerCommandParams = z.infer<typeof WorkerCommandParamsSchema>;

export const WorkerCommandResultSchema = z.object({
  commandId: NonEmptyStringSchema,
  data: z.unknown().optional(),
});

export type WorkerCommandResult = z.infer<typeof WorkerCommandResultSchema>;

export function parseWorkerIpcRequest(input: unknown): WorkerIpcRequest {
  return WorkerIpcRequestSchema.parse(input);
}

export function parseWorkerIpcResponse(input: unknown): WorkerIpcResponse {
  return WorkerIpcResponseSchema.parse(input);
}

export function safeParseWorkerIpcResponse(input: unknown) {
  return WorkerIpcResponseSchema.safeParse(input);
}

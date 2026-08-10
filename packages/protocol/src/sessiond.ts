import { z } from "zod";
import { RuntimeCommandSchema } from "./commands.js";
import {
  NonEmptyStringSchema,
  ProtocolErrorSchema,
  ThinkingLevelSchema,
  WorkerStatusSchema,
} from "./common.js";
import { RuntimeEventSchema } from "./events.js";
import { ResumeStatusSchema } from "./handshake.js";
import { RuntimeSnapshotSchema } from "./snapshot.js";
import { ProtocolVersionSchema } from "./version.js";

/**
 * Web host ↔ pi-sessiond RPC envelope.
 * Transport may be unix socket, localhost TCP, or in-process; wire shape is fixed.
 */

export const SessiondRpcMethodSchema = z.enum([
  "ping",
  "handshake",
  "session.create",
  "session.attach",
  "session.detach",
  "session.get",
  "session.list",
  "session.delete",
  "session.command",
  "session.snapshot",
  "session.abort",
  "worker.status",
  "worker.recycle",
]);

export type SessiondRpcMethod = z.infer<typeof SessiondRpcMethodSchema>;

export const SessiondRpcRequestSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  id: NonEmptyStringSchema,
  method: SessiondRpcMethodSchema,
  params: z.unknown().optional(),
});

export type SessiondRpcRequest = z.infer<typeof SessiondRpcRequestSchema>;

export const SessiondRpcSuccessSchema = z.object({
  id: NonEmptyStringSchema,
  ok: z.literal(true),
  result: z.unknown().optional(),
});

export const SessiondRpcFailureSchema = z.object({
  id: NonEmptyStringSchema,
  ok: z.literal(false),
  error: ProtocolErrorSchema,
});

export const SessiondRpcResponseSchema = z.discriminatedUnion("ok", [
  SessiondRpcSuccessSchema,
  SessiondRpcFailureSchema,
]);

export type SessiondRpcResponse = z.infer<typeof SessiondRpcResponseSchema>;

/** Server-push frames on the same sessiond channel (events / snapshots). */
export const SessiondPushEventSchema = z.object({
  type: z.literal("event"),
  sessionId: NonEmptyStringSchema,
  event: RuntimeEventSchema,
});

export const SessiondPushSnapshotSchema = z.object({
  type: z.literal("snapshot"),
  sessionId: NonEmptyStringSchema,
  snapshot: RuntimeSnapshotSchema,
  resumeStatus: ResumeStatusSchema.optional(),
});

export const SessiondPushSchema = z.discriminatedUnion("type", [
  SessiondPushEventSchema,
  SessiondPushSnapshotSchema,
]);

export type SessiondPush = z.infer<typeof SessiondPushSchema>;

// --- Method-specific payloads ---

export const SessionCreateParamsSchema = z.object({
  /** Idempotency key — repeated creates with same id return the same session. */
  createRequestId: NonEmptyStringSchema,
  cwd: NonEmptyStringSchema,
  sessionId: NonEmptyStringSchema.optional(),
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
});

export type SessionCreateParams = z.infer<typeof SessionCreateParamsSchema>;

export const SessionCreateResultSchema = z.object({
  sessionId: NonEmptyStringSchema,
  epoch: z.number().int().nonnegative(),
  created: z.boolean(),
  workerStatus: WorkerStatusSchema.optional(),
});

export type SessionCreateResult = z.infer<typeof SessionCreateResultSchema>;

export const SessionAttachParamsSchema = z.object({
  sessionId: NonEmptyStringSchema,
  epoch: z.number().int().nonnegative().optional(),
  lastEventId: z.string().optional(),
});

export type SessionAttachParams = z.infer<typeof SessionAttachParamsSchema>;

export const SessionAttachResultSchema = z.object({
  sessionId: NonEmptyStringSchema,
  epoch: z.number().int().nonnegative(),
  lastEventId: NonEmptyStringSchema,
  resumeStatus: ResumeStatusSchema,
  snapshot: RuntimeSnapshotSchema.optional(),
});

export type SessionAttachResult = z.infer<typeof SessionAttachResultSchema>;

export const SessionDetachParamsSchema = z.object({
  sessionId: NonEmptyStringSchema,
});

export const SessionCommandParamsSchema = z.object({
  sessionId: NonEmptyStringSchema,
  command: RuntimeCommandSchema,
});

export type SessionCommandParams = z.infer<typeof SessionCommandParamsSchema>;

export const SessionCommandResultSchema = z.object({
  commandId: NonEmptyStringSchema,
  data: z.unknown().optional(),
});

export type SessionCommandResult = z.infer<typeof SessionCommandResultSchema>;

export const SessionListItemSchema = z.object({
  sessionId: NonEmptyStringSchema,
  cwd: z.string().optional(),
  sessionFile: z.string().optional(),
  workerStatus: WorkerStatusSchema.optional(),
  epoch: z.number().int().nonnegative().optional(),
  name: z.string().optional(),
});

export type SessionListItem = z.infer<typeof SessionListItemSchema>;

export const SessionListResultSchema = z.object({
  sessions: z.array(SessionListItemSchema),
});

export function parseSessiondRpcRequest(input: unknown): SessiondRpcRequest {
  return SessiondRpcRequestSchema.parse(input);
}

export function parseSessiondRpcResponse(input: unknown): SessiondRpcResponse {
  return SessiondRpcResponseSchema.parse(input);
}

export function safeParseSessiondRpcResponse(input: unknown) {
  return SessiondRpcResponseSchema.safeParse(input);
}

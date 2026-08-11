import { z } from "zod";
import { RuntimeCommandSchema } from "./commands.js";
import {
  NonEmptyStringSchema,
  ProtocolErrorSchema,
} from "./common.js";
import { RuntimeEventSchema } from "./events.js";
import {
  ProtocolHandshakeRejectSchema,
  ProtocolHandshakeRequestSchema,
  ProtocolHandshakeResponseSchema,
  ResumeStatusSchema,
  RuntimeAttachParamsSchema,
} from "./handshake.js";
import { RuntimeSnapshotSchema } from "./snapshot.js";

/**
 * Browser ↔ Host WebSocket envelope for `/v1/runtime`.
 * One connection may attach/detach multiple sessions over time.
 */

export const WsHandshakeMessageSchema = z.strictObject({
  type: z.literal("handshake"),
  id: NonEmptyStringSchema.optional(),
  payload: ProtocolHandshakeRequestSchema,
});

export const WsHandshakeAckMessageSchema = z.strictObject({
  type: z.literal("handshake_ack"),
  id: NonEmptyStringSchema.optional(),
  payload: ProtocolHandshakeResponseSchema,
});

export const WsHandshakeRejectMessageSchema = z.strictObject({
  type: z.literal("handshake_reject"),
  id: NonEmptyStringSchema.optional(),
  payload: ProtocolHandshakeRejectSchema,
});

export const WsAttachMessageSchema = z.strictObject({
  type: z.literal("attach"),
  id: NonEmptyStringSchema.optional(),
  payload: RuntimeAttachParamsSchema,
});

export const WsDetachMessageSchema = z.strictObject({
  type: z.literal("detach"),
  id: NonEmptyStringSchema.optional(),
  payload: z.strictObject({
    sessionId: NonEmptyStringSchema,
  }),
});

export const WsCommandMessageSchema = z.strictObject({
  type: z.literal("command"),
  id: NonEmptyStringSchema.optional(),
  payload: z.strictObject({
    sessionId: NonEmptyStringSchema,
    command: RuntimeCommandSchema,
  }),
});

export const WsResponseMessageSchema = z.strictObject({
  type: z.literal("response"),
  id: NonEmptyStringSchema,
  payload: z.strictObject({
    sessionId: NonEmptyStringSchema.optional(),
    commandId: NonEmptyStringSchema.optional(),
    ok: z.boolean(),
    data: z.unknown().optional(),
    error: ProtocolErrorSchema.optional(),
  }),
});

export const WsSnapshotMessageSchema = z.strictObject({
  type: z.literal("snapshot"),
  id: NonEmptyStringSchema.optional(),
  payload: RuntimeSnapshotSchema.extend({
    resumeStatus: ResumeStatusSchema.optional(),
  }),
});

export const WsEventMessageSchema = z.strictObject({
  type: z.literal("event"),
  id: NonEmptyStringSchema.optional(),
  payload: RuntimeEventSchema,
});

export const WsRuntimeUnavailableMessageSchema = z.strictObject({
  type: z.literal("runtime_unavailable"),
  id: NonEmptyStringSchema.optional(),
  payload: z.strictObject({
    sessionId: NonEmptyStringSchema.optional(),
    error: ProtocolErrorSchema,
  }),
});

export const WsClientMessageSchema = z.discriminatedUnion("type", [
  WsHandshakeMessageSchema,
  WsAttachMessageSchema,
  WsDetachMessageSchema,
  WsCommandMessageSchema,
]);

export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export const WsHostMessageSchema = z.discriminatedUnion("type", [
  WsHandshakeAckMessageSchema,
  WsHandshakeRejectMessageSchema,
  WsResponseMessageSchema,
  WsSnapshotMessageSchema,
  WsEventMessageSchema,
  WsRuntimeUnavailableMessageSchema,
]);

export type WsHostMessage = z.infer<typeof WsHostMessageSchema>;

/** Any direction WS envelope (for logging / generic parsers). */
export const WsEnvelopeSchema = z.union([
  WsClientMessageSchema,
  WsHostMessageSchema,
]);

export type WsEnvelope = z.infer<typeof WsEnvelopeSchema>;

export function parseWsClientMessage(input: unknown): WsClientMessage {
  return WsClientMessageSchema.parse(input);
}

export function parseWsHostMessage(input: unknown): WsHostMessage {
  return WsHostMessageSchema.parse(input);
}

export function safeParseWsClientMessage(input: unknown) {
  return WsClientMessageSchema.safeParse(input);
}

export function safeParseWsHostMessage(input: unknown) {
  return WsHostMessageSchema.safeParse(input);
}

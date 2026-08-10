import { z } from "zod";
import { HostCapabilitiesSchema } from "./capabilities.js";
import { NonEmptyStringSchema, ProtocolErrorSchema } from "./common.js";
import { ProtocolVersionSchema } from "./version.js";

export const ClientShellSchema = z.enum(["web", "pwa"]);
export type ClientShell = z.infer<typeof ClientShellSchema>;

export const ClientPlatformSchema = z.enum([
  "win",
  "mac",
  "linux",
  "ios",
  "android",
  "unknown",
]);
export type ClientPlatform = z.infer<typeof ClientPlatformSchema>;

export const ClientIdentitySchema = z.object({
  shell: ClientShellSchema,
  platform: ClientPlatformSchema,
});
export type ClientIdentity = z.infer<typeof ClientIdentitySchema>;

export const HostModeSchema = z.enum(["local", "lan"]);
export type HostMode = z.infer<typeof HostModeSchema>;

export const HostInfoSchema = z.object({
  mode: HostModeSchema,
  capabilities: HostCapabilitiesSchema,
});
export type HostInfo = z.infer<typeof HostInfoSchema>;

export const HostLimitsSchema = z.object({
  maxUpload: z.number().nonnegative(),
  maxOpenSessions: z.number().nonnegative(),
});
export type HostLimits = z.infer<typeof HostLimitsSchema>;

/** Client → Host handshake (WS /v1/runtime open). */
export const ProtocolHandshakeRequestSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  client: ClientIdentitySchema,
  features: z.array(z.string()).default([]),
  auth: z.string().optional(),
});
export type ProtocolHandshakeRequest = z.infer<
  typeof ProtocolHandshakeRequestSchema
>;

/** Host → Client handshake ack. */
export const ProtocolHandshakeResponseSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  host: HostInfoSchema,
  limits: HostLimitsSchema,
  sessionSnapshotSupport: z.boolean(),
  serverTime: z.number().int().optional(),
});
export type ProtocolHandshakeResponse = z.infer<
  typeof ProtocolHandshakeResponseSchema
>;

/** Explicit handshake failure (version / auth / etc.). */
export const ProtocolHandshakeRejectSchema = z.object({
  protocolVersion: ProtocolVersionSchema.or(z.number()).optional(),
  error: ProtocolErrorSchema,
});
export type ProtocolHandshakeReject = z.infer<
  typeof ProtocolHandshakeRejectSchema
>;

export const ResumeStatusSchema = z.enum([
  "resumed",
  "snapshot",
  "gap",
  "epoch_changed",
]);
export type ResumeStatus = z.infer<typeof ResumeStatusSchema>;

/**
 * Attach to a session with optional resume cursor.
 * epoch + lastEventId enable gap detection and snapshot fallback.
 */
export const RuntimeAttachParamsSchema = z.object({
  sessionId: NonEmptyStringSchema,
  epoch: z.number().int().nonnegative().optional(),
  lastEventId: z.string().optional(),
  /**
   * Idempotency key for create-on-attach / create session flows.
   * Hosts must treat equal createRequestId as the same create.
   */
  createRequestId: NonEmptyStringSchema.optional(),
  cwd: z.string().optional(),
});
export type RuntimeAttachParams = z.infer<typeof RuntimeAttachParamsSchema>;

export const RuntimeAttachResultSchema = z.object({
  sessionId: NonEmptyStringSchema,
  epoch: z.number().int().nonnegative(),
  lastEventId: NonEmptyStringSchema,
  resumeStatus: ResumeStatusSchema,
});
export type RuntimeAttachResult = z.infer<typeof RuntimeAttachResultSchema>;

import { z } from "zod";
import {
  ExtensionWidgetPlacementSchema,
  NonEmptyStringSchema,
} from "./common.js";

const requestTiming = {
  timeout: z.number().nonnegative().optional(),
  expiresAt: z.number().optional(),
};

/** Strict method-discriminated extension request; cross-method fields reject. */
export const ExtensionUiRequestSchema = z.discriminatedUnion("method", [
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("select"), title: z.string(), options: z.array(z.string()).min(1), ...requestTiming }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("confirm"), title: z.string(), message: z.string(), ...requestTiming }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("input"), title: z.string(), placeholder: z.string().optional(), ...requestTiming }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("editor"), title: z.string(), prefill: z.string().optional(), ...requestTiming }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("notify"), message: z.string(), notifyType: z.enum(["info", "warning", "error"]), ...requestTiming }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("setStatus"), statusKey: NonEmptyStringSchema, statusText: z.string().optional(), ...requestTiming }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("setWidget"), widgetKey: NonEmptyStringSchema, widgetLines: z.array(z.string()).optional(), widgetPlacement: ExtensionWidgetPlacementSchema.optional(), ...requestTiming }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("setTitle"), title: z.string(), ...requestTiming }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("set_editor_text"), text: z.string(), ...requestTiming }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("custom"), lines: z.array(z.string()), ...requestTiming }),
]);
export type ExtensionUiRequest = z.infer<typeof ExtensionUiRequestSchema>;
export const ExtensionUiRequestMethodSchema = z.enum([
  "select", "confirm", "input", "editor", "notify", "setStatus",
  "setWidget", "setTitle", "set_editor_text", "custom",
]);
export type ExtensionUiRequestMethod = z.infer<typeof ExtensionUiRequestMethodSchema>;

/**
 * Only interactive methods produce client responses. Method is retained on the
 * wire for request-kind validation; Worker mapper may drop it for Runtime Core.
 */
export const ExtensionUiResponsePayloadSchema = z.discriminatedUnion("responseKind", [
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("select"), responseKind: z.literal("selected"), selected: z.string() }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("confirm"), responseKind: z.literal("confirmed"), confirmed: z.boolean() }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.enum(["input", "editor", "custom"]), responseKind: z.literal("value"), value: z.string() }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.enum(["select", "confirm", "input", "editor", "custom"]), responseKind: z.literal("cancelled"), cancelled: z.literal(true) }),
]);
export type ExtensionUiResponsePayload = z.infer<typeof ExtensionUiResponsePayloadSchema>;

/** Streaming input updates are only valid for input/editor requests. */
export const ExtensionUiInputPayloadSchema = z.discriminatedUnion("method", [
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("input"), data: z.string() }),
  z.strictObject({ id: NonEmptyStringSchema, method: z.literal("editor"), data: z.string() }),
]);
export type ExtensionUiInputPayload = z.infer<typeof ExtensionUiInputPayloadSchema>;

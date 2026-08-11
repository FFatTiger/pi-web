import type {
  SessiondMethodParams,
  SessiondMethodResult,
  SessiondRpcRequest,
  SessiondRpcResponse,
} from "./sessiond.js";
import type { RuntimeCommandOutcome, RuntimeInterruptResult } from "./results.js";

/** Compile-time assertions for method/payload/result discrimination. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

type CreateRequest = Extract<SessiondRpcRequest, { method: "runtime.create" }>;
type AttachRequest = Extract<SessiondRpcRequest, { method: "runtime.attach" }>;
type CreateSuccess = Extract<SessiondRpcResponse, { ok: true; method: "runtime.create" }>;
type CommandSuccess = Extract<SessiondRpcResponse, { ok: true; method: "runtime.command" }>;
type AttachFailure = Extract<SessiondRpcResponse, { ok: false; method: "runtime.attach" }>;

export type ProtocolTypeAssertions =
  | Assert<Equal<CreateRequest["params"], SessiondMethodParams["runtime.create"]>>
  | Assert<Equal<AttachRequest["params"], SessiondMethodParams["runtime.attach"]>>
  | Assert<Equal<CreateSuccess["result"], SessiondMethodResult["runtime.create"]>>
  | Assert<Equal<CommandSuccess["result"], SessiondMethodResult["runtime.command"]>>
  | Assert<Equal<AttachFailure["method"], "runtime.attach">>
  | Assert<Equal<Extract<RuntimeCommandOutcome, { ok: true; type: "fork" }>["forkedSessionId"], string>>
  | Assert<Equal<Extract<RuntimeInterruptResult, { ok: false }>["error"]["retryable"], boolean>>;

export const protocolTypeAssertions: ProtocolTypeAssertions = true;

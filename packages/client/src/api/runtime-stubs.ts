/**
 * Runtime / session transport stubs.
 *
 * The live agent channel is WebSocket `/v1/runtime` with snapshot/resume.
 * This shell deliberately does NOT open SSE streams, poll, or invent a WS protocol.
 *
 * TODO(host): replace these interfaces with real protocol clients from
 * `@fffattiger/pi-web-protocol` + host attach helpers.
 */

export type RuntimeConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error";

export interface RuntimeAttachParams {
  sessionId: string;
  lastEventId?: string;
  epoch?: number;
}

/**
 * Placeholder for the future SessionStore event projection.
 * Consumers should depend on this interface, not a concrete transport.
 */
export interface RuntimeClient {
  readonly state: RuntimeConnectionState;
  /** Attach is a no-op stub until protocol is wired. */
  attach(params: RuntimeAttachParams): Promise<void>;
  detach(): void;
}

export function createRuntimeClientStub(): RuntimeClient {
  let state: RuntimeConnectionState = "idle";
  return {
    get state() {
      return state;
    },
    async attach(_params: RuntimeAttachParams) {
      // No network — shell remains readonly without host runtime.
      state = "closed";
    },
    detach() {
      state = "idle";
    },
  };
}

/** Demo / empty adapter for transcript until sessions API exists. */
export interface SessionListItem {
  id: string;
  title: string;
  cwd?: string;
  updatedAt?: string;
}

export interface SessionsApi {
  list(params?: { cwd?: string }): Promise<SessionListItem[]>;
}

export function createSessionsApiStub(): SessionsApi {
  return {
    async list() {
      return [];
    },
  };
}

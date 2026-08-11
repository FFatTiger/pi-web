/**
 * Independent control channel on {@link AgentRuntimePort}.
 *
 * Control operations (abort-family and queue clearing) go through a dedicated
 * `interrupt()` method so they are never blocked behind long-running
 * prompt / bash / compact work. They are idempotent: interrupting an
 * operation that is not running resolves as a no-op.
 */
export type RuntimeInterrupt =
  | { type: "abort" }
  | { type: "abort_compaction" }
  | { type: "abort_bash" }
  | { type: "clear_queue" };

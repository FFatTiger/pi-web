/**
 * pi-web Hono Host Foundation (H0A) — protocol-independent.
 *
 * Owns gate, request security (Host/Origin/DNS-rebinding), static client
 * hosting, health/capabilities and the WebSocket upgrade seam. Runtime
 * protocol wiring (H0B) and resource services (H1x) are injected through
 * {@link createHostApp}'s deps; this package imports no Pi SDK, sessiond or
 * protocol code.
 */

export { createHostApp } from "./app.js";
export type { HostApp } from "./app.js";
export { createNodeServer, exposureModeForBind } from "./server.js";
export type { NodeServerHandle, NodeServerOptions } from "./server.js";
export { HttpError, apiErrorBody, isV1Path, unifiedErrorHandler } from "./errors.js";
export type { ApiErrorBody } from "./errors.js";
export { consoleLogger, silentLogger } from "./logger.js";

export { readGateConfig, createEnvGateConfigSource, defaultGateConfigPath } from "./gate/config.js";
export type { ReadGateConfigOptions } from "./gate/config.js";
export { decideGateRequest } from "./gate/decision.js";
export type { GateDecision, GateDecisionInput } from "./gate/decision.js";
export { gateMiddleware } from "./gate/middleware.js";
export { isGatePublicPath, isPublicPwaAssetPath, isPublicViteAssetPath, sanitizeNextPath, PUBLIC_PWA_ASSETS } from "./gate/paths.js";
export { createInMemoryRateLimiter } from "./gate/rate-limit.js";
export type { InMemoryRateLimiterOptions } from "./gate/rate-limit.js";
export { createInMemoryRevocationStore } from "./gate/revocation.js";
export type { InMemoryRevocationOptions } from "./gate/revocation.js";
export { registerGateRoutes } from "./gate/routes.js";
export {
  createSessionToken,
  readSessionToken,
  verifySessionToken,
  passwordsMatch,
  DEFAULT_GATE_COOKIE_NAME,
  DEFAULT_SESSION_TTL_MS,
} from "./gate/token.js";

export { securityMiddleware, isHostTrusted, isOriginAllowed, resolveHostMode } from "./middleware/security.js";
export type { SecurityOptions, HostCheckResult } from "./middleware/security.js";
export { requestIdMiddleware } from "./middleware/request-id.js";
export { loggingMiddleware } from "./middleware/logging.js";

export { resolveCapabilities, registerHealthRoutes } from "./routes/health.js";
export type { SessiondState, ResolvedCapabilities } from "./routes/health.js";

export { staticAssetsMiddleware, resolveClientFile } from "./static/static-assets.js";
export type { StaticAssetsOptions } from "./static/static-assets.js";
export { spaOrJsonNotFound } from "./static/spa.js";
export type { SpaFallbackOptions } from "./static/spa.js";

export { createRuntimeWsRoute, DEFAULT_HELLO_TIMEOUT_MS } from "./ws/guard.js";
export type { WsGuardOptions } from "./ws/guard.js";

export {
  ALL_HOST_CAPABILITIES,
  READONLY_HOST_CAPABILITIES,
} from "./types.js";
export type {
  GateConfig,
  GateConfigSource,
  GateDeps,
  GateStatusKind,
  HostCapability,
  HostCapabilityDeps,
  HostDeps,
  HostLogger,
  HostMode,
  LoginRateLimiter,
  RuntimeWsSeam,
  SessionRevocationStore,
  SessiondProbe,
  TrustedProxyOptions,
  WsSession,
} from "./types.js";

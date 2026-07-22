import { randomBytes } from "node:crypto";
import {
  createRunningEventsHandler,
  getRunningEventsAuthFingerprint,
  runningEventsPresenceRegistry,
} from "@/lib/running-events";
import { getRunningRpcSessionIds, subscribeRunningSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = createRunningEventsHandler({
  createConnectionId: () => randomBytes(16).toString("base64url"),
  getAuthFingerprint: getRunningEventsAuthFingerprint,
  registry: runningEventsPresenceRegistry,
  getRunningIds: getRunningRpcSessionIds,
  subscribe: subscribeRunningSessions,
});

// GET /api/agent/running/events - SSE stream of the set of currently-running
// session ids. Pushes an update whenever any session starts or stops working,
// so the sidebar never has to poll. Optionally registers authenticated presence.
export async function GET(req: Request): Promise<Response> {
  return handler(req);
}

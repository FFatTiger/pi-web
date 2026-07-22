import { readPushConfig } from "@/lib/push-config";
import { createStatusHandler } from "@/lib/push-route-handlers";
import { getPushStore } from "@/lib/push-store";
import { readGateConfig } from "@/lib/web-auth-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = createStatusHandler({
  readGateConfig,
  readPushConfig,
  store: getPushStore(),
});

export async function GET(request: Request): Promise<Response> {
  return handler(request);
}

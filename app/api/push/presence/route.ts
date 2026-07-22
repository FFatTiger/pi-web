import { getPresenceRegistry } from "@/lib/push-presence";
import { createPresenceHandler } from "@/lib/push-route-handlers";
import { computeAuthFingerprint, getPushStore } from "@/lib/push-store";
import { readGateConfig } from "@/lib/web-auth-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getFingerprint(password: string): Promise<string> {
  const keys = await getPushStore().getVapidKeys();
  return computeAuthFingerprint(password, keys.privateKey);
}

const handler = createPresenceHandler({
  readGateConfig,
  getFingerprint,
  registry: getPresenceRegistry(),
});

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}

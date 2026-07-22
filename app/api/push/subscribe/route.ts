import { createSubscribeHandlers } from "@/lib/push-route-handlers";
import { getPushStore } from "@/lib/push-store";
import { readGateConfig } from "@/lib/web-auth-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handlers = createSubscribeHandlers({
  readGateConfig,
  store: getPushStore(),
});

export async function POST(request: Request): Promise<Response> {
  return handlers.POST(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handlers.DELETE(request);
}

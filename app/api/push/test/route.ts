import { randomUUID } from "node:crypto";
import { createTestHandler } from "@/lib/push-route-handlers";
import { getPushService } from "@/lib/push-service";
import { readGateConfig } from "@/lib/web-auth-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = createTestHandler({
  readGateConfig,
  service: getPushService(),
  createId: randomUUID,
});

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}

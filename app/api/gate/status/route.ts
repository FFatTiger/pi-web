import { NextResponse } from "next/server";
import { readGateConfig, toPublicGateStatus } from "@/lib/web-auth-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(toPublicGateStatus(readGateConfig()), {
    headers: { "Cache-Control": "no-store" },
  });
}

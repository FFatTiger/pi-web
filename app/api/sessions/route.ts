import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds, getRegistryOnlySessions } from "@/lib/rpc-manager";

export async function GET() {
  try {
    const sessions = await listAllSessions();
    const existingIds = new Set(sessions.map((s) => s.id));
    const now = new Date().toISOString();
    for (const { id, cwd, messageCount, firstMessage } of getRegistryOnlySessions()) {
      if (existingIds.has(id)) continue;
      sessions.push({
        path: "",
        id,
        cwd,
        name: undefined,
        created: now,
        modified: now,
        messageCount,
        firstMessage,
      });
    }
    return NextResponse.json({ sessions, runningSessionIds: getRunningRpcSessionIds() });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

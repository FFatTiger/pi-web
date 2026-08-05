import { NextResponse } from "next/server";
import { allowFileRoot } from "@/lib/file-access";
import { createTempSessionCwd, getTempSessionRoot } from "@/lib/temp-session";

// POST /api/default-cwd
// Creates a Codex-style temporary session cwd under
// ~/.pi/agent/temp-session/YYYY-MM-DD/f[-N] and returns the path.
export async function POST() {
  try {
    const cwd = createTempSessionCwd();
    // Allow browsing the session cwd and the shared temp-session root.
    allowFileRoot(getTempSessionRoot());
    allowFileRoot(cwd);
    return NextResponse.json({ cwd });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

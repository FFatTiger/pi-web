import { NextResponse } from "next/server";
import { allowFileRoot } from "@/lib/file-access";
import { createTempSessionCwd, getTempSessionRoot } from "@/lib/temp-session";

// POST /api/default-cwd
// Creates a Codex-style temporary session cwd under
// ~/.pi/agent/temp-session/YYYY-MM-DD/f[-N] and returns the path.
// projectRoot is the shared temp-session root so Recent chats group together.
export async function POST() {
  try {
    const projectRoot = getTempSessionRoot();
    const cwd = createTempSessionCwd();
    allowFileRoot(projectRoot);
    allowFileRoot(cwd);
    return NextResponse.json({ cwd, projectRoot });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

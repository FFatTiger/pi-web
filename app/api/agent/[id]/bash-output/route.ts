import { NextResponse } from "next/server";
import { resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { getRpcSession } from "@/lib/rpc-manager";

// GET /api/agent/[id]/bash-output?path=<absPath>
// Reads the full (truncated) bash output temp file for a session.
// Guarded by a session-scoped allowlist + temp-prefix + path-traversal checks.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let path: string | null = null;
  try {
    const url = new URL(_req.url);
    path = url.searchParams.get("path");
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  if (!path) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const wrapper = getRpcSession(id);
  if (!wrapper || !wrapper.isAlive() || !wrapper.isBashOutputPathAllowed(path)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Path traversal + temp-prefix guard. pi writes bash full output to
  // `<tmpdir>/pi-bash-<id>.log` (see bash-executor.ts). Validate that the
  // resolved path's directory is exactly tmpdir and its basename matches
  // the pi-bash-*.log shape — this blocks traversal, arbitrary temp files,
  // and prefix-cousin attacks like /tmp/pi-bash-evil.
  const resolved = resolve(path);
  const tmpDir = resolve(tmpdir());
  const dir = dirname(resolved);
  const base = basename(resolved);
  if (dir !== tmpDir || !/^pi-bash-.*\.log$/.test(base)) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  try {
    const content = await readFile(resolved, "utf-8");
    return NextResponse.json({ success: true, data: { output: content } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/useAppPresence.ts", import.meta.url), "utf8");
const toast = readFileSync(new URL("./AppToast.tsx", import.meta.url), "utf8");
const perSession = readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");

test("only AppShell's presence hook owns the global running EventSource", () => {
  assert.match(shell, /useAppPresence\(\)/);
  assert.match(hook, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.equal([...hook.matchAll(/new EventSource\(/g)].length, 1);
  assert.doesNotMatch(sidebar, /new EventSource|\/api\/agent\/running\/events/);
  assert.doesNotMatch(shell, /new EventSource|\/api\/agent\/running\/events/);
});

test("per-session SSE remains unchanged", () => {
  assert.match(
    perSession,
    /new EventSource\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}\/events`\)/,
  );
});

test("AppShell passes live running state and mounts the app-level toast", () => {
  assert.match(shell, /liveRunningSessionIds=\{presence\.runningSessionIds\}/);
  assert.match(shell, /runningAuthoritative=\{presence\.runningAuthoritative\}/);
  assert.match(shell, /<AppToast/);
});

test("presence heartbeats only with a connectionId and reports visibility", () => {
  assert.match(hook, /const HEARTBEAT_MS = 15_000/);
  assert.match(hook, /if \(!id\) return/);
  assert.match(hook, /visibility: document\.visibilityState === "visible" \? "visible" : "hidden"/);
  assert.match(hook, /document\.addEventListener\("visibilitychange"/);
  assert.match(hook, /if \(document\.visibilityState !== "visible"\) return/);
  assert.match(hook, /source\.close\(\)/);
});

test("toast ACKs only after mount and only while visible", () => {
  assert.match(toast, /useEffect\(/);
  assert.match(toast, /onShown\(toast\.id\)/);
  assert.match(toast, /document\.visibilityState !== "visible"/);
  assert.doesNotMatch(hook, /reportPresence\(message\.notification\.id\)|ackNotificationId:\s*message\.notification\.id/);
  assert.match(hook, /if \(seen\.has\(notificationId\)\) return/);
});

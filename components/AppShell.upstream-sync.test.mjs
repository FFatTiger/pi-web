import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./WorkspaceFilePanel.tsx", import.meta.url), "utf8");

test("AppShell wires cwd deep-link, auto-name, and multi-project skip", () => {
  assert.match(shell, /getInitialNavigation/);
  assert.match(shell, /skipInitialProjectSelection=\{initialNavigation\.requestedCwd !== null\}/);
  assert.match(shell, /handleAutoName/);
  assert.match(shell, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/auto-name/);
  assert.match(shell, /\/api\/cwd\/validate/);
  assert.match(shell, /setInitialCwdStatus\("validating"\)/);
  assert.match(shell, /Generate a session title|Generate title/);
  // Fork multi-project shell remains the AppShell base.
  assert.match(shell, /onSelectProject=\{handleSelectProject\}/);
  assert.match(shell, /liveRunningSessionIds=\{presence\.runningSessionIds\}/);
  assert.match(shell, /useAppPresence/);
  assert.match(shell, /useWebPush/);
});

test("SessionSidebar accepts skipInitialProjectSelection and keeps multi-project restore", () => {
  assert.match(sidebar, /skipInitialProjectSelection\?: boolean/);
  assert.match(sidebar, /if \(skipInitialProjectSelection\) return;/);
  assert.match(sidebar, /function PiWebTitle/);
  assert.match(sidebar, /onSelectProject/);
  assert.match(sidebar, /liveRunningSessionIds/);
});

test("WorkspaceFilePanel forwards gitRefreshKey for upstream diff viewer", () => {
  assert.match(panel, /gitRefreshKey=\{explorerRefreshKey\}/);
});

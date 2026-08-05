import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./sidebar-session-sort.ts");
}

function session(id, modified) {
  return {
    id,
    path: `/s/${id}`,
    cwd: "/repo",
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id,
  };
}

test("updated_at sorts by recency boost over file mtime (Codex recencyAt)", async () => {
  const { sortSessionsForChatMode } = await loadSubject();
  const sessions = [
    session("old", "2026-08-01T10:00:00.000Z"),
    session("mid", "2026-08-02T10:00:00.000Z"),
    session("new", "2026-08-03T10:00:00.000Z"),
  ];
  const boost = new Map([["old", Date.parse("2026-08-05T12:00:00.000Z")]]);
  const sorted = sortSessionsForChatMode(sessions, {
    mode: "updated_at",
    activityBoostMs: boost,
  });
  assert.deepEqual(sorted.map((s) => s.id), ["old", "new", "mid"]);
});

test("priority ranks running then unread then recency", async () => {
  const { sortSessionsForChatMode } = await loadSubject();
  const sessions = [
    session("idle-new", "2026-08-05T12:00:00.000Z"),
    session("unread-old", "2026-08-01T12:00:00.000Z"),
    session("running", "2026-08-02T12:00:00.000Z"),
  ];
  const sorted = sortSessionsForChatMode(sessions, {
    mode: "priority",
    runningSessionIds: new Set(["running"]),
    unreadSessionIds: new Set(["unread-old"]),
  });
  assert.deepEqual(sorted.map((s) => s.id), ["running", "unread-old", "idle-new"]);
});

test("manual order is preserved and prepends unknown ids", async () => {
  const { sortSessionsForChatMode } = await loadSubject();
  const sessions = [
    session("a", "2026-08-05T12:00:00.000Z"),
    session("b", "2026-08-04T12:00:00.000Z"),
    session("c", "2026-08-03T12:00:00.000Z"),
  ];
  const sorted = sortSessionsForChatMode(sessions, {
    mode: "manual",
    manualOrder: ["c", "a"],
  });
  assert.deepEqual(sorted.map((s) => s.id), ["b", "c", "a"]);
});

test("sessionRecencyMs prefers the max of mtime and boost", async () => {
  const { sessionRecencyMs } = await loadSubject();
  const s = session("x", "2026-08-01T00:00:00.000Z");
  const boost = new Map([["x", Date.parse("2026-08-10T00:00:00.000Z")]]);
  assert.equal(sessionRecencyMs(s, boost), Date.parse("2026-08-10T00:00:00.000Z"));
  assert.equal(sessionRecencyMs(s), Date.parse("2026-08-01T00:00:00.000Z"));
});

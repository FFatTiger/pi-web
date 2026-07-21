import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./sidebar-projects.ts");
}

function session(overrides = {}) {
  return {
    path: "/sessions/base.jsonl",
    id: "base",
    cwd: "/repos/base",
    projectRoot: "/repos/base",
    created: "2026-07-20T00:00:00.000Z",
    modified: "2026-07-20T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "base",
    ...overrides,
  };
}

test("groups linked worktrees by project root and sorts by latest session activity", async () => {
  const { groupSidebarProjects } = await loadSubject();
  const groups = groupSidebarProjects([
    session({ id: "a-main", cwd: "/repos/a", projectRoot: "/repos/a", modified: "2026-07-20T09:00:00.000Z" }),
    session({ id: "a-wt", cwd: "/repos/a-worktrees/feature", projectRoot: "/repos/a", modified: "2026-07-20T11:00:00.000Z" }),
    session({ id: "b", cwd: "/repos/b", projectRoot: "/repos/b", modified: "2026-07-20T10:00:00.000Z" }),
  ], []);

  assert.deepEqual(groups.map((group) => group.root), ["/repos/a", "/repos/b"]);
  assert.deepEqual(groups[0].sessions.map((item) => item.id), ["a-wt", "a-main"]);
  assert.equal(groups[0].latestActivity, "2026-07-20T11:00:00.000Z");
});

test("deduplicates manual projects against session-backed projects", async () => {
  const { groupSidebarProjects } = await loadSubject();
  const groups = groupSidebarProjects(
    [session({ id: "a", cwd: "/repos/a", projectRoot: "/repos/a" })],
    [
      { root: "/repos/a", lastOpened: "2026-07-21T12:00:00.000Z" },
      { root: "/repos/empty", lastOpened: "2026-07-21T11:00:00.000Z" },
    ],
  );

  assert.deepEqual(groups.map((group) => [group.root, group.manual, group.sessions.length]), [
    ["/repos/empty", true, 0],
    ["/repos/a", true, 1],
  ]);
});

test("reports running before unread and unread before idle", async () => {
  const { getProjectActivity } = await loadSubject();
  const sessions = [session({ id: "one" }), session({ id: "two" })];

  assert.equal(getProjectActivity(sessions, new Set(["one"]), new Set(["two"])), "running");
  assert.equal(getProjectActivity(sessions, new Set(), new Set(["two"])), "unread");
  assert.equal(getProjectActivity(sessions, new Set(), new Set()), "idle");
});

test("does not reorder projects when only external activity sets change", async () => {
  const { groupSidebarProjects, getProjectActivity } = await loadSubject();
  const groups = groupSidebarProjects([
    session({ id: "newer", projectRoot: "/repos/newer", cwd: "/repos/newer", modified: "2026-07-21T12:00:00.000Z" }),
    session({ id: "older", projectRoot: "/repos/older", cwd: "/repos/older", modified: "2026-07-21T11:00:00.000Z" }),
  ], []);

  assert.deepEqual(groups.map((group) => group.root), ["/repos/newer", "/repos/older"]);
  assert.equal(getProjectActivity(groups[1].sessions, new Set(["older"]), new Set()), "running");
  assert.deepEqual(groups.map((group) => group.root), ["/repos/newer", "/repos/older"]);
});

test("round-trips manual projects and removes malformed entries", async () => {
  const { parseManualProjects, serializeManualProjects, upsertManualProject } = await loadSubject();
  const parsed = parseManualProjects(JSON.stringify([
    { root: "/repos/a", lastOpened: "2026-07-21T12:00:00.000Z" },
    { root: 42, lastOpened: "bad" },
    null,
  ]));

  assert.deepEqual(parsed, [{ root: "/repos/a", lastOpened: "2026-07-21T12:00:00.000Z" }]);
  assert.deepEqual(parseManualProjects("not json"), []);
  assert.deepEqual(
    upsertManualProject(parsed, "/repos/a", "2026-07-21T13:00:00.000Z"),
    [{ root: "/repos/a", lastOpened: "2026-07-21T13:00:00.000Z" }],
  );
  assert.equal(
    serializeManualProjects(parsed),
    '[{"root":"/repos/a","lastOpened":"2026-07-21T12:00:00.000Z"}]',
  );
});

test("round-trips expanded projects and falls back for damaged data", async () => {
  const { parseExpandedProjects, serializeExpandedProjects } = await loadSubject();
  assert.deepEqual([...parseExpandedProjects('["/repos/b","/repos/a","/repos/a"]')], ["/repos/b", "/repos/a"]);
  assert.deepEqual([...parseExpandedProjects("not json")], []);
  assert.equal(serializeExpandedProjects(new Set(["/repos/b", "/repos/a"])), '["/repos/b","/repos/a"]');
});

test("builds fork trees and resolves through missing ancestors", async () => {
  const { buildSidebarSessionTree } = await loadSubject();
  const tree = buildSidebarSessionTree([
    session({ id: "root", modified: "2026-07-21T10:00:00.000Z" }),
    session({ id: "missing-child", parentSessionId: "missing", modified: "2026-07-21T12:00:00.000Z" }),
    session({ id: "leaf", parentSessionId: "missing-child", modified: "2026-07-21T13:00:00.000Z" }),
    session({ id: "child", parentSessionId: "root", modified: "2026-07-21T11:00:00.000Z" }),
  ]);

  assert.deepEqual(tree.map((node) => node.session.id), ["missing-child", "root"]);
  assert.deepEqual(tree[0].children.map((node) => node.session.id), ["leaf"]);
  assert.deepEqual(tree[1].children.map((node) => node.session.id), ["child"]);
});

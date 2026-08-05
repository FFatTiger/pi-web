import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Side Chat creates empty sessions with a boundary and does not branch-copy turns", async () => {
  const source = await readFile(new URL("./side-chat-manager.ts", import.meta.url), "utf8");
  const createSource = source.slice(
    source.indexOf("async function createSideChatSession"),
    source.indexOf("async function warmSideSession"),
  );
  const openSource = source.slice(source.indexOf("export async function openSideChat"));

  assert.doesNotMatch(createSource, /createBranchedSession/);
  assert.match(createSource, /SessionManager\.create\(mainCwd, mainSessionDir, \{ parentSession: mainSessionPath \}\)/);
  assert.match(createSource, /injectBoundary\(manager\)/);
  assert.match(source, /appendCustomMessageEntry/);
  assert.match(source, /SIDE_CHAT_BOUNDARY_TEXT/);
  assert.match(createSource, /ensureSessionPersisted\(manager\)/);
  assert.match(createSource, /toolMode/);
  assert.match(openSource, /startRpcSession\(mainSessionId, mainSessionPath/);
  assert.match(openSource, /const mainLeafId = mainManager\.getLeafId\(\)/);
  assert.match(openSource, /action === "create"|forceNew/);
  assert.match(openSource, /isSideChatExpired/);
});

test("Refork and Clear abort an active side run and inherit current main preferences", async () => {
  const source = await readFile(new URL("./side-chat-manager.ts", import.meta.url), "utf8");
  const openSource = source.slice(source.indexOf("export async function openSideChat"));

  assert.match(openSource, /abortSideSession\(target\)/);
  assert.match(openSource, /getSessionPreferences\(mainManager\)/);
  assert.match(openSource, /action === "refork" \|\| action === "clear"/);
  assert.match(openSource, /markInactive\(target\)/);
});

test("Side Chat supports multi-session open/create/send/set_mode and peek activity anchor", async () => {
  const source = await readFile(new URL("./side-chat-manager.ts", import.meta.url), "utf8");
  assert.match(source, /\| "create"/);
  assert.match(source, /\| "set_mode"/);
  assert.match(source, /\| "send"/);
  assert.match(source, /sideSessionId/);
  assert.match(source, /type: "prompt"/);
  assert.match(source, /applyToolMode/);
  assert.match(source, /forkLeafId: activityLeafId/);
});

test("Side Chat RPC startup disables package extensions so MCP cannot setStatus", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(source, /noExtensions: true/);
  assert.match(source, /extensionFactories: \[sideChatExtension\]/);
  assert.match(source, /getSideChatToolSelection\(sideChatMetadata\.toolMode\)/);
});

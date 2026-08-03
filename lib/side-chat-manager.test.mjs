import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Side Chat branching never mutates the live main-session manager", async () => {
  const source = await readFile(new URL("./side-chat-manager.ts", import.meta.url), "utf8");
  const createSource = source.slice(
    source.indexOf("async function createSideChatSession"),
    source.indexOf("export async function openSideChat"),
  );
  const openSource = source.slice(source.indexOf("export async function openSideChat"));

  assert.match(createSource, /branchSourceManager\.createBranchedSession\(contextLeafId\)/);
  assert.doesNotMatch(createSource, /mainManager\.createBranchedSession/);
  assert.match(createSource, /mainSessionId,/);
  assert.match(createSource, /SessionManager\.create\(mainCwd, mainSessionDir, \{ parentSession: mainSessionPath \}\)/);
  assert.match(createSource, /ensureSessionPersisted\(manager\)/);
  assert.match(openSource, /startRpcSession\(mainSessionId, mainSessionPath/);
  assert.doesNotMatch(openSource, /warm\?\.isAlive\(\)/);
  assert.doesNotMatch(
    openSource.slice(openSource.indexOf('if (action === "open" && current)'), openSource.indexOf("const currentWrapper")),
    /\.shutdown\(\)/,
  );
  assert.match(openSource, /const mainManager = mainSession\.inner\.sessionManager/);
  assert.match(openSource, /const mainLeafId = mainManager\.getLeafId\(\)/);
  assert.match(openSource, /const contextLeafId = mainSession\.getSideChatContextLeafId\(\)/);
  assert.match(openSource, /const branchSourceManager = SessionManager\.open\(mainSessionPath, mainManager\.getSessionDir\(\)\)/);
});

test("Refork and Clear abort an active side run and inherit current main preferences", async () => {
  const source = await readFile(new URL("./side-chat-manager.ts", import.meta.url), "utf8");
  const openSource = source.slice(source.indexOf("export async function openSideChat"));

  assert.match(openSource, /currentWrapper\.send\(\{ type: "abort" \}\)/);
  assert.match(openSource, /getSessionPreferences\(mainManager\)/);
  assert.doesNotMatch(openSource, /SideChatToolMode|toolMode/);
  assert.doesNotMatch(openSource, /action === "clear" && current/);
  assert.doesNotMatch(openSource, /Wait for the current Side Chat response to finish/);
});

test("Side Chat separates settled fork context from the peek_main activity anchor", async () => {
  const source = await readFile(new URL("./side-chat-manager.ts", import.meta.url), "utf8");
  const createSource = source.slice(
    source.indexOf("async function createSideChatSession"),
    source.indexOf("export async function openSideChat"),
  );

  assert.match(createSource, /const forkLeafId = activityLeafId/);
  assert.match(createSource, /if \(!clear && contextLeafId\)/);
  assert.match(createSource, /createBranchedSession\(contextLeafId\)/);
});

test("Side Chat RPC startup disables package extensions so MCP cannot setStatus", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(source, /noExtensions: true/);
  assert.match(source, /extensionFactories: \[sideChatExtension\]/);
  assert.match(source, /includeExtensionTools: false|getSideChatToolSelection\(\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Side Chat reuses the main ChatInput without exposing generic tool presets", async () => {
  const source = await readFile(new URL("./SideChatPanel.tsx", import.meta.url), "utf8");

  assert.match(source, /import \{ ChatInput, type ChatInputHandle \} from "\.\/ChatInput"/);
  assert.match(source, /<ChatInput/);
  assert.match(source, /model=\{displayModel\}/);
  assert.match(source, /onModelChange=\{handleModelChange\}/);
  assert.match(source, /onThinkingLevelChange=\{handleThinkingLevelChange\}/);
  assert.match(source, /messagePlaceholder=\{t\("sideChat\.placeholder"\)\}/);
  assert.match(source, /useI18n/);
  assert.match(source, /sideChat\.title/);
  assert.match(source, /sideChat\.refork/);
  assert.match(source, /sideChat\.clear/);
  assert.match(source, /headerIconBtnStyle/);
  assert.match(source, /border: "none"/);
  assert.match(source, /RefreshIcon/);
  assert.match(source, /ClearIcon/);
  assert.match(source, /aria-label=\{t\("sideChat\.refork"\)\}/);
  assert.doesNotMatch(source, /<span>\{t\("sideChat\.refork"\)\}<\/span>/);
  assert.doesNotMatch(source, /SideChatComposer/);
  assert.doesNotMatch(source, /onToolPresetChange=/);
  assert.doesNotMatch(source, /toggleToolMode|sideChat\.readonly|sideChat\.edit|set_mode/);
});

test("ChatInput hides built-in slash commands when no handler is supplied", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

  assert.match(source, /isStreaming \|\| !onBuiltinCommand \? \[\] : BUILTIN_SLASH_COMMANDS/);
  assert.match(source, /padding: "0 16px 15px"/);
  assert.doesNotMatch(source, /reserveMinimapSpace/);
  assert.doesNotMatch(source, /paddingRight: isMobile \? 16 : 52/);
});

test("Side Chat actions remain available while its agent is running", async () => {
  const source = await readFile(new URL("./SideChatPanel.tsx", import.meta.url), "utf8");

  assert.match(source, /const controlsDisabled = actionBusy \|\| !sideSession/);
  assert.doesNotMatch(source, /conversationBusy/);
  assert.doesNotMatch(source, /onBusyChange/);
});

test("Side Chat renders only messages created after its persisted marker", async () => {
  const source = await readFile(new URL("./SideChatPanel.tsx", import.meta.url), "utf8");

  assert.match(source, /data\?\.context\.hiddenMessageEntryIds/);
  assert.match(source, /const visibleMessages = useMemo/);
  assert.match(source, /hiddenMessageEntryIds\.has\(entryId\)/);
  assert.match(source, /visibleMessages\.map\(\(\{ message, index \}\)/);
  assert.match(source, /entryId=\{entryIds\[index\]\}/);
});

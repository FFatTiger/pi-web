import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatInput = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const providerIcon = readFileSync(new URL("./ProviderIcon.tsx", import.meta.url), "utf8");
const sessionInfoBar = readFileSync(new URL("./SessionInfoBar.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const english = readFileSync(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const chinese = readFileSync(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

function block(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing ${startNeedle}`);
  assert.ok(end > start, `missing ${endNeedle}`);
  return source.slice(start, end);
}

test("composer keeps editor and toolbar in one two-row shell with reference control order", () => {
  const shell = chatInput.slice(chatInput.indexOf("className={`chat-input-shell"));
  assert.ok(shell.indexOf('className="chat-input-editor-row"') < shell.indexOf('className="chat-input-toolbar"'));

  const toolbar = shell.slice(shell.indexOf('className="chat-input-toolbar"'));
  const attachment = toolbar.indexOf("chat-input-toolbar-attach");
  const reasoning = toolbar.indexOf("chat-input-toolbar-thinking");
  const spacer = toolbar.indexOf("chat-input-toolbar-spacer");
  const tools = toolbar.indexOf("chat-input-toolbar-tools");
  const model = toolbar.indexOf("chat-input-toolbar-model");
  const send = toolbar.indexOf("chat-input-send");
  assert.ok(attachment < reasoning && reasoning < spacer && spacer < tools && tools < model && model < send);
  assert.doesNotMatch(toolbar, /onSoundToggle|chat\.compactContext/);
});

test("model selector uses ProviderIcon at 14px with a caret", () => {
  assert.match(chatInput, /import \{ ProviderIcon \} from "\.\/ProviderIcon"/);
  assert.match(chatInput, /<ProviderIcon id=\{model\?\.provider \?\? "unknown"\} size=\{14\} \/>/);
  assert.match(chatInput, /viewBox="0 0 12 12"[\s\S]*?m3 4\.5 3 3 3-3/);
  assert.match(providerIcon, /@lobehub\/icons/);
  assert.doesNotMatch(providerIcon, /@phosphor-icons/);
  assert.match(providerIcon, /function ProviderFallback/);
});

test("ChatWindow renders and wires SessionInfoBar immediately after ChatInput in both branches", () => {
  assert.match(chatWindow, /import \{ SessionInfoBar \} from "\.\/SessionInfoBar"/);
  assert.equal((chatWindow.match(/\{chatInputElement\}\s*\{sessionInfoBarElement\}/g) ?? []).length, 2);
  assert.match(chatWindow, /const CHAT_COLUMN_PADDING = 16;/);
  assert.match(chatWindow, /const showMinimap = !isMobile && !hideMinimap;/);
  assert.doesNotMatch(chatWindow, /CHAT_INPUT_RIGHT_PADDING|CHAT_MINIMAP_WIDTH/);
  assert.match(chatWindow, /soundEnabled=\{soundEnabled\}/);
  assert.match(chatWindow, /onCompact=\{session \|\| isNew \? handleCompact : undefined\}/);
  assert.match(chatWindow, /onAbortCompaction=\{handleAbortCompaction\}/);
  assert.match(chatWindow, /sessionStats=\{sessionStats\}/);
  assert.match(chatWindow, /contextUsage=\{contextUsage\}/);
  assert.match(chatWindow, /onStatsOpen=\{onSessionStatsPanelOpen\}/);
  assert.doesNotMatch(chatInput, /soundEnabled\?:|onSoundToggle\?:|onCompact\?:/);
});

test("footer follows reference sound, spacer, compact, stats, context ordering and values", () => {
  const sound = sessionInfoBar.indexOf("onClick={onSoundToggle}");
  const spacer = sessionInfoBar.indexOf('className="session-info-bar-spacer"');
  const compact = sessionInfoBar.indexOf("session-info-bar-compact");
  const stats = sessionInfoBar.indexOf('className="session-info-bar-stats"');
  const context = sessionInfoBar.indexOf('className="session-info-bar-context"');
  assert.ok(sound < spacer && spacer < compact && compact < stats && stats < context);

  assert.match(sessionInfoBar, /tokens\.input > 0/);
  assert.match(sessionInfoBar, /formatTokenCount\(tokens\.input\)/);
  assert.match(sessionInfoBar, /tokens\.output > 0/);
  assert.match(sessionInfoBar, /formatTokenCount\(tokens\.output\)/);
  assert.match(sessionInfoBar, /tokens\.cacheRead > 0/);
  assert.match(sessionInfoBar, /formatTokenCount\(tokens\.cacheRead\)/);
  assert.match(sessionInfoBar, /cost > 0/);
  assert.match(sessionInfoBar, /cost >= 0\.01 \? `\$\$\{cost\.toFixed\(2\)\}` : "<\$0\.01"/);
  assert.match(sessionInfoBar, /tokens\.cacheWrite\.toLocaleString\(\)/); // detailed tooltip only
  assert.doesNotMatch(sessionInfoBar, /tokens\.cacheRead \+ tokens\.cacheWrite|formatTokenCount\(tokens\.total\)/);
  assert.doesNotMatch(sessionInfoBar, /formatTokenCount\(contextUsage\.tokens|formatTokenCount\(contextUsage\.contextWindow/);
});

test("model panel always searches, right-anchors safely, and exposes dialog semantics", () => {
  assert.doesNotMatch(chatInput, /MODEL_FILTER_THRESHOLD|showModelFilter/);
  const panel = block(chatInput, "{modelDropdownOpen && modelDropdownRect", "{isStreaming && (");
  assert.match(panel, /placeholder=\{t\("chat\.filterModels"\)\}/);
  assert.match(panel, /left: Math\.max\(8, modelDropdownRect\.right - Math\.min\(360, viewportWidth - 16\)\)/);
  assert.match(panel, /maxWidth: "min\(360px, calc\(100vw - 16px\)\)"/);
  assert.match(panel, /minWidth: Math\.min\(Math\.max\(220, modelDropdownRect\.width\), viewportWidth - 16\)/);
  assert.match(panel, /maxHeight: maxH/);
  assert.match(panel, /\? \{ left: 8, right: 8, width: "auto", maxWidth: "calc\(100vw - 16px\)" \}/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /aria-modal="false"/);
  assert.match(panel, /aria-label=\{t\("chat\.selectModel"\)\}/);
  assert.match(panel, /aria-current=\{isActive \? "true" : undefined\}/);
  assert.doesNotMatch(panel, /role="listbox"|role="option"|aria-selected/);
  assert.match(chatInput, /aria-label=\{modelOptions\.length > 0 \? t\("chat\.changeModel"\) : t\("chat\.noAvailableModels"\)\}/);
  assert.match(chatInput, /aria-expanded=\{modelDropdownOpen\}/);
  assert.match(chatInput, /aria-haspopup="dialog"/);
});

test("newly visible model and history states are localized in both locales", () => {
  for (const key of ["chat.changeModel", "chat.noAvailableModels", "chat.selectModel", "chat.inputHistory", "chat.noMatchingModels"]) {
    assert.match(english, new RegExp(`"${key.replace(".", "\\.")}"`));
    assert.match(chinese, new RegExp(`"${key.replace(".", "\\.")}"`));
  }
  assert.match(chatInput, /title=\{t\("chat\.inputHistory"\)\}/);
  assert.match(chatInput, /t\("chat\.noMatchingModels"\)/);
  assert.match(chatInput, /t\("chat\.noAvailableModels"\)/);
  assert.doesNotMatch(chatInput, /"Change model"|"No available models"|"Select model"|"No models"|title="Input history"/);
});

test("composer and status CSS locks reference dimensions and current 52px minimap integration", () => {
  assert.match(css, /--bg-secondary: #fafafa;/);
  assert.match(css, /--bg-card: #ffffff;/);
  assert.match(css, /--bg-secondary: #151515;/);
  assert.match(css, /--bg-card: #1e1e1e;/);
  assert.equal((css.match(/--accent-blue: var\(--accent\);/g) ?? []).length, 2);

  const composer = block(css, ".chat-input-shell {", "/* File viewer toolbar */");
  for (const expected of [
    "width: calc(100% + 20px);",
    "margin-left: -10px;",
    "border: 1px solid var(--border);",
    "border-radius: 8px;",
    "background: var(--bg-secondary);",
    "box-shadow: none;",
    "padding: 6px 12px;",
    "font-family: var(--font-mono);",
    "line-height: 1.625;",
    "min-height: 32px;",
    "padding: 4px;",
    "min-height: 50px !important;",
    "transform: scale(0.97);",
    "margin-top: -15px;",
    "height: 26px;",
  ]) assert.match(composer, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(chatInput, /padding: "0 16px 15px"/);
  assert.doesNotMatch(chatInput, /paddingRight: isMobile \? 16 : 52/);
  assert.doesNotMatch(css, /padding-right: 52px;/);
  assert.match(composer, /@media \(max-width: 640px\)[\s\S]*?\.chat-input-toolbar \{[\s\S]*?padding: 6px 12px;[\s\S]*?flex-wrap: nowrap;[\s\S]*?overflow: visible;/);
  assert.match(composer, /\.chat-input-toolbar-model \{ flex: 1 1 88px !important; min-width: 48px !important; max-width: 128px; overflow: hidden; \}/);
  assert.match(composer, /\.chat-input-send \{ flex-shrink: 0; \}/);
  assert.doesNotMatch(composer, /\.chat-input-shell \{ width: 100%; margin-left: 0; \}/);
  assert.doesNotMatch(composer, /0 0 0 3px/);
});

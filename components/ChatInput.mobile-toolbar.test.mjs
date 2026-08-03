import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("mobile composer shows all controls inline and keeps send in the toolbar row", () => {
  assert.doesNotMatch(source, /controlsMenuOpen|setControlsMenuOpen|chat\.moreControls|chat\.collapseControls/);
  assert.match(source, /className="chat-input-toolbar"[\s\S]*?display: "flex"/);
  assert.match(source, /className="chat-input-toolbar-actions"[\s\S]*?display: "flex"/);
  assert.match(source, /chat-input-toolbar-tools[\s\S]*?chat-input-toolbar-model[\s\S]*?chat-input-send/);
});

test("opening the model picker on mobile does not summon the software keyboard", () => {
  assert.match(source, /if \(isMobile\) textareaRef\.current\?\.blur\(\);/);
  assert.match(source, /autoFocus=\{!isMobile\}/);
  assert.doesNotMatch(source, /\sautoFocus\s*\n/);
});

test("mobile toolbar leaves upward dropdowns visible", () => {
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.chat-input-toolbar \{[\s\S]*?overflow: visible;/);
  assert.match(source, /thinkingDropdownOpen && \([\s\S]*?bottom: "calc\(100% \+ 6px\)"/);
  assert.match(source, /toolDropdownOpen && \([\s\S]*?bottom: "calc\(100% \+ 6px\)"/);
});

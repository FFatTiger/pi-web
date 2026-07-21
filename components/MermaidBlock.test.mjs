import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MermaidBlock } = await jiti.import("./MermaidBlock.tsx");

// Simple sequenceDiagram for testing
const mermaidSrc = `sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Alice: Hi`;

test("MermaidBlock renders preview view by default (loading placeholder in SSR)", () => {
  const html = renderToStaticMarkup(
    React.createElement(MermaidBlock, { code: mermaidSrc }),
  );

  // Defaults to preview mode; SSR can't run useEffect so we see the loading
  // placeholder (not source code and not error).
  assert.match(html, /mermaid-block-loading/);
  assert.doesNotMatch(html, /mermaid-block-error/);
  // Source code should NOT appear since we are in preview mode.
  assert.doesNotMatch(html, /Alice/);
});

test("MermaidBlock shows 'Source' toggle when preview is default", () => {
  const html = renderToStaticMarkup(
    React.createElement(MermaidBlock, { code: mermaidSrc }),
  );

  assert.match(html, />Source</);
  assert.doesNotMatch(html, />Preview</);
});

test("MermaidBlock with isStreaming falls back to source view", () => {
  const html = renderToStaticMarkup(
    React.createElement(MermaidBlock, { code: mermaidSrc, isStreaming: true }),
  );

  // Streaming forces source view. Button reflects current showPreview state
  // (true by default → shows "Source"), and is disabled.
  assert.match(html, /disabled/);
  // Mermaid source code must be visible in the syntax-highlighted block.
  assert.match(html, /Alice/);
  assert.match(html, /-&gt;&gt;/);
});

test("MermaidBlock renders empty graph without error", () => {
  const html = renderToStaticMarkup(
    React.createElement(MermaidBlock, { code: "graph TD" }),
  );

  // Should fall through to loading placeholder, never crash.
  assert.doesNotMatch(html, /mermaid-block-error/);
});

test("MermaidBlock handles Chinese characters in diagram", () => {
  const chineseMermaid = `sequenceDiagram
    participant PC as PC客户端
    PC->>SV: 请求登录`;

  const html = renderToStaticMarkup(
    React.createElement(MermaidBlock, { code: chineseMermaid }),
  );

  // In preview-default mode (SSR), content is in loading state, not source.
  // Verify we didn't crash on Chinese text.
  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block/);
});

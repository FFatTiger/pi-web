/**
 * react-syntax-highlighter 16 + React 19 fix:
 * the bundled Prism themes use the `background` shorthand on `pre`, and React 19
 * warns when a rerender removes `backgroundColor` while `background` is set.
 * Normalize every style node to longhand `backgroundColor` so no shorthand/longhand
 * mix ever reaches the DOM style prop.
 */

type ThemeNode = Record<string, string>;

function normalizeStyleNode(style: ThemeNode | undefined): ThemeNode | undefined {
  if (!style) return undefined;
  const next: ThemeNode = {};
  for (const [key, value] of Object.entries(style)) {
    if (key === "background" && !("backgroundColor" in style)) {
      next.backgroundColor = value;
    } else {
      next[key] = value;
    }
  }
  return next;
}

/**
 * Deep-convert `background` → `backgroundColor` across a Prism theme.
 * Preserves the input's generic type so it stays assignable to
 * SyntaxHighlighter's `{ [key: string]: CSSProperties }`.
 */
export function normalizeCodeTheme<T extends Record<string, unknown>>(theme: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(theme)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = normalizeStyleNode(value as ThemeNode);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/** Use longhand so customStyle never clashes with the theme's shorthand. */
export function codeBlockBackground(color: string): { backgroundColor: string } {
  return { backgroundColor: color };
}

/**
 * Codex thread-summary layout (from app.asar):
 *
 *   side = (mainContentWidth - 736) / 2
 *   displayMode =
 *     side < 180  → "overlay"  // too narrow: float/popover, no layout reserve
 *     side < 400  → "shift"    // mid width: shift content left by half panel
 *     else        → "gutter"   // wide: panel sits in the right gutter, no shift
 *
 *   contentShift = (pinned && displayMode === "shift") ? -(300 + 16) / 2 : 0
 *
 * contentShift is applied as transform translateX on the thread content column
 * (NOT as container padding — the scrollbar stays full-width).
 */

export type SummaryDisplayMode = "overlay" | "shift" | "gutter";

/** Codex reference content width used for side-gutter math. */
export const CODEX_THREAD_CONTENT_WIDTH = 736;

/** Codex summary panel width (Root style.width). */
export const CODEX_SUMMARY_PANEL_WIDTH = 300;

/** Codex Root `pe-4` (16px) trailing padding next to the panel. */
export const CODEX_SUMMARY_PANEL_TRAILING = 16;

const OVERLAY_SIDE_MAX = 180;
const SHIFT_SIDE_MAX = 400;

export function getSummaryDisplayMode(mainContentWidth: number): SummaryDisplayMode {
  const side = (mainContentWidth - CODEX_THREAD_CONTENT_WIDTH) / 2;
  if (side < OVERLAY_SIDE_MAX) return "overlay";
  if (side < SHIFT_SIDE_MAX) return "shift";
  return "gutter";
}

/**
 * Signed X offset for the thread content column (Codex MotionValue `x`).
 * Negative = shift left. Zero in overlay/gutter (or when closed).
 */
export function getSummaryContentShift(opts: {
  open: boolean;
  mainContentWidth: number;
}): number {
  if (!opts.open) return 0;
  const mode = getSummaryDisplayMode(opts.mainContentWidth);
  if (mode !== "shift") return 0;
  return -(CODEX_SUMMARY_PANEL_WIDTH + CODEX_SUMMARY_PANEL_TRAILING) / 2;
}

/** Reserved right-edge footprint of the floating panel (width + pe-4). */
export function getSummaryPanelReserveWidth(): number {
  return CODEX_SUMMARY_PANEL_WIDTH + CODEX_SUMMARY_PANEL_TRAILING;
}

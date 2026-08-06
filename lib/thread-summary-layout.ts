/**
 * Codex thread-summary layout (from app.asar):
 *
 *   side = (mainContentWidth - contentWidth) / 2
 *   displayMode =
 *     side < 180  → "overlay"  // too narrow: float/popover, no layout reserve
 *     side < 400  → "shift"    // mid width: shift content left by half panel
 *     else        → "gutter"   // wide: panel sits in the right gutter, no shift
 *
 *   contentShift = (pinned && displayMode === "shift") ? -(300 + 16) / 2 : 0
 *
 * contentShift is applied as transform translateX on the thread content column
 * (NOT as container padding — the scrollbar stays full-width).
 *
 * Important: contentWidth must match the actual chat content max width.
 * Using a smaller reference than the real column makes shift mode over-shift
 * and clips the left edge of the conversation.
 */

export type SummaryDisplayMode = "overlay" | "shift" | "gutter";

/** Chat content column max width used by ChatWindow and summary side-gutter math. */
export const CHAT_CONTENT_MAX_WIDTH = 820;

/** Codex summary panel width (Root style.width). */
export const CODEX_SUMMARY_PANEL_WIDTH = 300;

/** Codex Root `pe-4` (16px) trailing padding next to the panel. */
export const CODEX_SUMMARY_PANEL_TRAILING = 16;

const OVERLAY_SIDE_MAX = 180;
const SHIFT_SIDE_MAX = 400;

export function getSummarySideWidth(
  mainContentWidth: number,
  contentWidth = CHAT_CONTENT_MAX_WIDTH,
): number {
  return (mainContentWidth - contentWidth) / 2;
}

export function getSummaryDisplayMode(mainContentWidth: number): SummaryDisplayMode {
  const side = getSummarySideWidth(mainContentWidth);
  if (side < OVERLAY_SIDE_MAX) return "overlay";
  if (side < SHIFT_SIDE_MAX) return "shift";
  return "gutter";
}

/**
 * Signed X offset for the thread content column (Codex MotionValue `x`).
 * Negative = shift left. Zero in overlay/gutter (or when closed).
 *
 * Clamp the left shift so the content column never moves past the left edge of
 * the main surface. This prevents the conversation from being clipped when the
 * measured main width is only slightly above the overlay threshold.
 */
export function getSummaryContentShift(opts: {
  open: boolean;
  mainContentWidth: number;
}): number {
  if (!opts.open) return 0;
  const mode = getSummaryDisplayMode(opts.mainContentWidth);
  if (mode !== "shift") return 0;
  const side = getSummarySideWidth(opts.mainContentWidth);
  const desired = -(CODEX_SUMMARY_PANEL_WIDTH + CODEX_SUMMARY_PANEL_TRAILING) / 2;
  // Keep at least a few pixels of left margin so text does not kiss the edge.
  const maxLeftShift = -Math.max(0, side - 8);
  return Math.max(desired, maxLeftShift);
}

/** Reserved right-edge footprint of the floating panel (width + pe-4). */
export function getSummaryPanelReserveWidth(): number {
  return CODEX_SUMMARY_PANEL_WIDTH + CODEX_SUMMARY_PANEL_TRAILING;
}

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  CHAT_CONTENT_MAX_WIDTH,
  getSummaryContentShift,
  getSummaryDisplayMode,
  getSummarySideWidth,
} = await jiti.import("./thread-summary-layout.ts");

test("uses the actual chat content width for side-gutter math", () => {
  assert.equal(CHAT_CONTENT_MAX_WIDTH, 820);
  assert.equal(getSummarySideWidth(1180), (1180 - 820) / 2);
});

test("classifies overlay/shift/gutter from available side width", () => {
  // side = (1000 - 820) / 2 = 90 → overlay
  assert.equal(getSummaryDisplayMode(1000), "overlay");
  // side = (1400 - 820) / 2 = 290 → shift
  assert.equal(getSummaryDisplayMode(1400), "shift");
  // side = (1800 - 820) / 2 = 490 → gutter
  assert.equal(getSummaryDisplayMode(1800), "gutter");
});

test("clamps shift so the content column does not leave the main surface", () => {
  assert.equal(getSummaryContentShift({ open: false, mainContentWidth: 1400 }), 0);
  assert.equal(getSummaryContentShift({ open: true, mainContentWidth: 1000 }), 0); // overlay
  assert.equal(getSummaryContentShift({ open: true, mainContentWidth: 1800 }), 0); // gutter

  // side = 290, desired = -158 → keep desired
  assert.equal(getSummaryContentShift({ open: true, mainContentWidth: 1400 }), -158);

  // side = 190, desired = -158, maxLeft = -(190 - 8) = -182 → still -158
  assert.equal(getSummaryContentShift({ open: true, mainContentWidth: 1200 }), -158);

  // side = 181, desired = -158, maxLeft = -(181 - 8) = -173 → still -158
  assert.equal(getSummaryContentShift({ open: true, mainContentWidth: 1182 }), -158);
});

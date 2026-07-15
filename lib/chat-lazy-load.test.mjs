import test from "node:test";
import assert from "node:assert/strict";

/**
 * Message lazy-load core logic (pure functions extracted from ChatWindow for testing)
 */

function sliceVisibleMessages(totalCount, visibleCount, pageSize) {
  const clamped = Math.min(visibleCount, totalCount);
  const startIdx = totalCount - clamped;
  return {
    startIdx,
    hasMore: startIdx > 0,
  };
}

function loadMoreMessages(totalCount, currentVisibleCount, pageSize) {
  return Math.min(currentVisibleCount + pageSize, totalCount);
}

// Save scroll position before prepending content
function computeScrollRestore(scrollHeight, scrollTop) {
  return scrollHeight - scrollTop;
}

// Restore scroll position after prepending content
function applyScrollRestore(newScrollHeight, savedDistance) {
  return Math.max(0, newScrollHeight - savedDistance);
}

// ====== Tests ======

test("sliceVisibleMessages shows last N when count < total", () => {
  const result = sliceVisibleMessages(200, 50, 50);
  assert.equal(result.startIdx, 150);
  assert.equal(result.hasMore, true);
});

test("sliceVisibleMessages shows all when visible >= total", () => {
  const result = sliceVisibleMessages(30, 50, 50);
  assert.equal(result.startIdx, 0);
  assert.equal(result.hasMore, false);
});

test("sliceVisibleMessages shows all when exactly equal", () => {
  const result = sliceVisibleMessages(50, 50, 50);
  assert.equal(result.startIdx, 0);
  assert.equal(result.hasMore, false);
});

test("sliceVisibleMessages empty list", () => {
  const result = sliceVisibleMessages(0, 50, 50);
  assert.equal(result.startIdx, 0);
  assert.equal(result.hasMore, false);
});

test("loadMoreMessages increases by pageSize", () => {
  assert.equal(loadMoreMessages(200, 50, 50), 100);
  assert.equal(loadMoreMessages(200, 100, 50), 150);
});

test("loadMoreMessages caps at totalCount", () => {
  assert.equal(loadMoreMessages(200, 175, 50), 200);
  assert.equal(loadMoreMessages(200, 200, 50), 200);
});

test("scrollRestore: prepending content keeps viewport stable", () => {
  const oldHeight = 2000;
  const oldScrollTop = 500;
  const savedDistance = computeScrollRestore(oldHeight, oldScrollTop);
  assert.equal(savedDistance, 1500);

  const newHeight = 2500;
  const newScrollTop = applyScrollRestore(newHeight, savedDistance);
  assert.equal(newScrollTop, 1000);
});

test("scrollRestore: at top of page", () => {
  const savedDistance = computeScrollRestore(2000, 0);
  assert.equal(savedDistance, 2000);
  const newScrollTop = applyScrollRestore(3000, 2000);
  assert.equal(newScrollTop, 1000);
});

test("scrollRestore: at bottom of page", () => {
  const savedDistance = computeScrollRestore(2000, 2000);
  assert.equal(savedDistance, 0);
  const newScrollTop = applyScrollRestore(3000, 0);
  assert.equal(newScrollTop, 3000);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { loadExplorerOpen, saveExplorerOpen } = await createJiti(import.meta.url).import("./file-explorer-state.ts");

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

test("defaults to open when storage is empty or unavailable", () => {
  assert.equal(loadExplorerOpen(null), true);
  assert.equal(loadExplorerOpen(memoryStorage()), true);
});

test("round-trips open and closed preferences", () => {
  const storage = memoryStorage();
  saveExplorerOpen(false, storage);
  assert.equal(loadExplorerOpen(storage), false);
  saveExplorerOpen(true, storage);
  assert.equal(loadExplorerOpen(storage), true);
});

test("treats only the string false as collapsed", () => {
  assert.equal(loadExplorerOpen(memoryStorage({ "pi-web:file-explorer:open": "false" })), false);
  assert.equal(loadExplorerOpen(memoryStorage({ "pi-web:file-explorer:open": "true" })), true);
  assert.equal(loadExplorerOpen(memoryStorage({ "pi-web:file-explorer:open": "0" })), true);
});

test("swallows storage access errors", () => {
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(loadExplorerOpen(broken), true);
  assert.doesNotThrow(() => saveExplorerOpen(false, broken));
});

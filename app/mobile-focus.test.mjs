import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");

test("mobile media query sets 16px font-size on editable controls", () => {
  assert.match(
    css,
    /@media\s*\([^)]*max-width:[^)]+\)[\s\S]*input[\s\S]*textarea[\s\S]*select[\s\S]*font-size:\s*16px\s*!important/,
  );
});

test("layout does not disable viewport zoom", () => {
  assert.doesNotMatch(layout, /maximumScale|max(?:imum)?-scale|userScalable|user-scalable/);
});

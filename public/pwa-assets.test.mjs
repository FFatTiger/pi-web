import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("manifest declares installable root-scoped assets", async () => {
  const { default: manifest } = await jiti.import("../app/manifest.ts");
  const value = manifest();
  assert.equal(value.name, "Pi Agent Web");
  assert.equal(value.short_name, "Pi Web");
  assert.equal(value.start_url, "/");
  assert.equal(value.scope, "/");
  assert.equal(value.display, "standalone");
  assert.deepEqual(value.icons.map(({ src, sizes, purpose }) => ({ src, sizes, purpose })), [
    { src: "/icons/icon-192.png", sizes: "192x192", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", purpose: "any" },
    { src: "/icons/maskable-512.png", sizes: "512x512", purpose: "maskable" },
  ]);
});

test("icons have exact dimensions and maskable art stays inside the safe square", () => {
  const script = `
import json
from PIL import Image
paths = {
  "icon-192.png": (192, 192), "icon-512.png": (512, 512),
  "maskable-512.png": (512, 512), "apple-touch-icon.png": (180, 180),
  "badge-96.png": (96, 96),
}
out = {}
for name, size in paths.items():
    im = Image.open("public/icons/" + name).convert("RGBA")
    assert im.size == size, (name, im.size)
    out[name] = {"size": im.size, "corner": im.getpixel((0, 0))}
print(json.dumps(out))
`;
  const result = JSON.parse(execFileSync("python3", ["-c", script], { encoding: "utf8" }));
  assert.deepEqual(result["maskable-512.png"].size, [512, 512]);
  assert.equal(result["maskable-512.png"].corner[3], 255);
  assert.ok(existsSync("public/offline.html"));
  assert.ok(readFileSync("public/offline.html", "utf8").includes("You are offline"));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.files.includes("app/manifest.ts"));
});

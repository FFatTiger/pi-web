import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { readPushConfig } = await jiti.import("./push-config.ts");
const configPath = "/tmp/pi-web.json";
const readJson = (value) => () => JSON.stringify(value);
const missing = () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; };

test("defaults Push to enabled with the project HTTPS subject", () => {
  assert.deepEqual(readPushConfig({ configPath, env: {}, readFile: missing }), {
    status: "enabled", configPath, subject: "https://github.com/agegr/pi-web",
  });
});

test("environment overrides file Push settings field by field", () => {
  assert.deepEqual(readPushConfig({
    configPath,
    env: { PI_WEB_PUSH_DISABLED: "false", PI_WEB_PUSH_SUBJECT: "mailto:env@example.com" },
    readFile: readJson({ push: { disabled: true, subject: "https://file.example" } }),
  }), { status: "enabled", configPath, subject: "mailto:env@example.com" });
});

test("explicit disable and invalid values do not affect ordinary gate parsing", () => {
  assert.deepEqual(readPushConfig({
    configPath, env: {}, readFile: readJson({ auth: { password: "secret" }, push: { disabled: true } }),
  }), { status: "disabled", configPath });
  for (const options of [
    { env: { PI_WEB_PUSH_DISABLED: "yes" }, readFile: missing },
    { env: { PI_WEB_PUSH_SUBJECT: "ftp://bad.example" }, readFile: missing },
    { env: {}, readFile: readJson({ push: { disabled: "false" } }) },
    { env: {}, readFile: readJson({ push: { subject: 3 } }) },
  ]) assert.equal(readPushConfig({ configPath, ...options }).status, "error");
});

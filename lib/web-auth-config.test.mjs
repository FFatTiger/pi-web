import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const jiti = createJiti(import.meta.url);
const { readGateConfig, toPublicGateStatus, getWebAuthConfigPath } = await jiti.import("./web-auth-config.ts");

const missingFile = () => {
  const error = new Error("missing");
  error.code = "ENOENT";
  throw error;
};

const readJson = (value) => () => JSON.stringify(value);

test("locks when pi-web.json does not exist", () => {
  assert.deepEqual(
    readGateConfig({ configPath: "/tmp/pi-web.json", readFile: missingFile, env: {} }),
    { status: "unconfigured", configPath: "/tmp/pi-web.json" },
  );
});

test("enables password authentication from the config file", () => {
  assert.deepEqual(
    readGateConfig({
      configPath: "/tmp/pi-web.json",
      readFile: readJson({ auth: { password: "local-secret", disabled: false } }),
      env: {},
    }),
    { status: "enabled", configPath: "/tmp/pi-web.json", password: "local-secret" },
  );
});

test("explicit disabled true bypasses authentication", () => {
  assert.deepEqual(
    readGateConfig({
      configPath: "/tmp/pi-web.json",
      readFile: readJson({ auth: { disabled: true } }),
      env: {},
    }),
    { status: "disabled", configPath: "/tmp/pi-web.json" },
  );
});

test("environment variables override only their own config fields", () => {
  const result = readGateConfig({
    configPath: "/tmp/pi-web.json",
    readFile: readJson({ auth: { password: "file-secret", disabled: true } }),
    env: { PI_WEB_PASSWORD: "env-secret", PI_WEB_AUTH_DISABLED: "false" },
  });
  assert.deepEqual(result, {
    status: "enabled",
    configPath: "/tmp/pi-web.json",
    password: "env-secret",
  });
});

test("wrong field types and invalid disabled env values remain locked", () => {
  for (const options of [
    { readFile: readJson({ auth: { password: 123 } }), env: {} },
    { readFile: readJson({ auth: { disabled: "true" } }), env: {} },
    { readFile: readJson({ auth: { password: "secret" } }), env: { PI_WEB_AUTH_DISABLED: "1" } },
  ]) {
    const result = readGateConfig({ configPath: "/tmp/pi-web.json", ...options });
    assert.equal(result.status, "error");
    assert.equal(result.configPath, "/tmp/pi-web.json");
  }
});

test("blank passwords are unconfigured rather than enabled", () => {
  assert.equal(
    readGateConfig({
      configPath: "/tmp/pi-web.json",
      readFile: readJson({ auth: { password: "   " } }),
      env: {},
    }).status,
    "unconfigured",
  );
});

test("public status strips passwords and internal log details", () => {
  assert.deepEqual(
    toPublicGateStatus({ status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" }),
    { status: "enabled", configPath: "/tmp/pi-web.json" },
  );
  assert.deepEqual(
    toPublicGateStatus({ status: "error", configPath: "/tmp/pi-web.json", logMessage: "EACCES details" }),
    { status: "error", configPath: "/tmp/pi-web.json" },
  );
});

test("getWebAuthConfigPath uses getAgentDir via PI_CODING_AGENT_DIR", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-web-auth-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = tempDir;
    assert.equal(getWebAuthConfigPath(), join(tempDir, "pi-web.json"));
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previous;
    }
  }
});

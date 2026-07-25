import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };

if (process.platform === "win32") {
  const buildHome = join(projectRoot, ".buildhome");
  const appData = join(buildHome, "Roaming");
  const localAppData = join(buildHome, "Local");
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  env.HOME = buildHome;
  env.USERPROFILE = buildHome;
  env.APPDATA = appData;
  env.LOCALAPPDATA = localAppData;
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "build", "--webpack"], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error("Failed to start Next.js build:", error);
  process.exit(1);
});

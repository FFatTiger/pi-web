import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const packageRoot = __dirname;
let version = "0.0.0";
let piVersion = "unknown";
try {
	version = (
		JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
			version: string;
		}
	).version;
} catch {
	/* package.json missing/invalid, use default */
}
try {
	const piPkgPath = join(
		packageRoot,
		"node_modules/@earendil-works/pi-coding-agent/package.json",
	);
	piVersion = (
		JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }
	).version;
} catch {
	/* package not found, use default */
}

const nextConfig: NextConfig = {
	// Nested git worktrees can sit under a monorepo with another lockfile.
	// Pin tracing to this package so production output does not follow the parent root.
	outputFileTracingRoot: packageRoot,
	serverExternalPackages: [
		"undici",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-ai",
		"@earendil-works/pi-tui",
	],
	allowedDevOrigins: [
		"192.168.*.*",
		"127.0.0.1",
		// frp / reverse-proxy public hostnames (HTTPS tunnel)
		"*.t.huu.im",
	],
	async headers() {
		return [
			{
				source: "/",
				headers: [
					{
						key: "Cache-Control",
						value: "private, no-cache, max-age=0, must-revalidate",
					},
				],
			},
			{
				source: "/sw.js",
				headers: [
					{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
					{ key: "Service-Worker-Allowed", value: "/" },
				],
			},
			{
				source: "/manifest.webmanifest",
				headers: [
					{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
				],
			},
		];
	},
	env: {
		NEXT_PUBLIC_APP_VERSION: version,
		NEXT_PUBLIC_PI_VERSION: piVersion,
	},
};

export default nextConfig;

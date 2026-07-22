import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";

export type ValidatedSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type ResolveAll = (
  hostname: string,
) => Promise<Array<{ address: string; family: 4 | 6 }>>;

export class PushInvalidSubscriptionError extends Error {
  readonly code = "PUSH_INVALID_SUBSCRIPTION";

  constructor(message = "Invalid push subscription") {
    super(message);
    this.name = "PushInvalidSubscriptionError";
  }
}

export class PushUnsafeEndpointError extends Error {
  readonly code = "PUSH_UNSAFE_ENDPOINT";

  constructor(message = "Unsafe push endpoint") {
    super(message);
    this.name = "PushUnsafeEndpointError";
  }
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const P256DH_CHARS = 87;
const AUTH_CHARS = 22;
const P256DH_BYTES = 65;
const AUTH_BYTES = 16;
const MAX_ENDPOINT_UTF8_BYTES = 4096;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(record: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(record);
  if (actual.length !== keys.length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function invalid(): never {
  throw new PushInvalidSubscriptionError();
}

function normalizeHostname(hostname: string): string {
  // Strip a single trailing dot (absolute DNS form) before policy checks.
  return hostname.endsWith(".") && hostname.length > 1
    ? hostname.slice(0, -1)
    : hostname;
}

function isLocalhostName(hostname: string): boolean {
  const lowered = hostname.toLowerCase();
  return lowered === "localhost" || lowered.endsWith(".localhost");
}

function isIpLiteralHostname(hostname: string): boolean {
  // WHATWG URL.hostname keeps brackets for IPv6 literals (e.g. "[::1]").
  const candidate =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  // Strip zone id if present (e.g. fe80::1%lo0) before classification.
  const withoutZone = candidate.includes("%")
    ? candidate.slice(0, candidate.indexOf("%"))
    : candidate;
  return net.isIP(withoutZone) !== 0;
}

function decodeExactBase64url(value: string, expectedBytes: number): Buffer | null {
  if (!BASE64URL_RE.test(value)) return null;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch {
    return null;
  }
  // Reject strings that re-encode differently (padding, non-canonical forms).
  if (decoded.toString("base64url") !== value) return null;
  if (decoded.length !== expectedBytes) return null;
  return decoded;
}

export function validatePushSubscription(value: unknown): ValidatedSubscription {
  if (!isPlainObject(value) || !hasExactKeys(value, ["endpoint", "keys"])) {
    invalid();
  }
  const { endpoint, keys } = value;
  if (typeof endpoint !== "string") invalid();
  if (Buffer.byteLength(endpoint, "utf8") > MAX_ENDPOINT_UTF8_BYTES) invalid();
  if (!isPlainObject(keys) || !hasExactKeys(keys, ["p256dh", "auth"])) invalid();

  const { p256dh, auth } = keys;
  if (typeof p256dh !== "string" || typeof auth !== "string") invalid();
  if (p256dh.length !== P256DH_CHARS || auth.length !== AUTH_CHARS) invalid();

  const p256dhBytes = decodeExactBase64url(p256dh, P256DH_BYTES);
  const authBytes = decodeExactBase64url(auth, AUTH_BYTES);
  if (!p256dhBytes || !authBytes) invalid();
  if (p256dhBytes[0] !== 0x04) invalid();

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    invalid();
  }

  if (url.protocol !== "https:") invalid();
  if (url.username !== "" || url.password !== "") invalid();

  const host = normalizeHostname(url.hostname);
  if (!host) invalid();
  if (isLocalhostName(host)) invalid();
  if (isIpLiteralHostname(host)) invalid();

  return { endpoint, p256dh, auth };
}

function parseIPv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    // Reject leading zeros that would make non-decimal ambiguity (except single 0).
    if (part.length > 1 && part.startsWith("0")) return null;
    octets.push(n);
  }
  return octets;
}

function isPublicIPv4(address: string): boolean {
  const octets = parseIPv4Octets(address);
  if (!octets) return false;
  const [a, b] = octets;

  // 0.0.0.0/8
  if (a === 0) return false;
  // 10.0.0.0/8
  if (a === 10) return false;
  // 100.64.0.0/10
  if (a === 100 && b >= 64 && b <= 127) return false;
  // 127.0.0.0/8
  if (a === 127) return false;
  // 169.254.0.0/16
  if (a === 169 && b === 254) return false;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return false;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return false;
  // 224.0.0.0/4 multicast
  if (a >= 224 && a <= 239) return false;
  // 240.0.0.0/4 reserved
  if (a >= 240) return false;

  return true;
}

/**
 * Expand a syntactically valid IPv6 address (net.isIP === 6) to eight lowercase
 * hextets so IPv4-mapped forms can be detected regardless of compression.
 * Handles dotted IPv4 tails (::ffff:a.b.c.d) by converting the final 32 bits.
 */
function expandIPv6Hextets(address: string): string[] | null {
  let addr = address.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);

  // Convert trailing dotted IPv4 (mapped / compatible forms) into two hextets.
  if (addr.includes(".")) {
    const lastColon = addr.lastIndexOf(":");
    if (lastColon === -1) return null;
    const dotted = addr.slice(lastColon + 1);
    const octets = parseIPv4Octets(dotted);
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  let parts: string[];
  if (addr.includes("::")) {
    const sides = addr.split("::");
    if (sides.length !== 2) return null;
    const head = sides[0] === "" ? [] : sides[0].split(":");
    const tail = sides[1] === "" ? [] : sides[1].split(":");
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;
    parts = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  } else {
    parts = addr.split(":");
  }
  if (parts.length !== 8) return null;
  const full: string[] = [];
  for (const h of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
    full.push(h.padStart(4, "0"));
  }
  return full;
}

function extractMappedIPv4(address: string): string | null {
  const hextets = expandIPv6Hextets(address);
  if (!hextets) return null;
  // IPv4-mapped: 0000:0000:0000:0000:0000:ffff:XXXX:YYYY
  if (
    hextets[0] !== "0000" ||
    hextets[1] !== "0000" ||
    hextets[2] !== "0000" ||
    hextets[3] !== "0000" ||
    hextets[4] !== "0000" ||
    hextets[5] !== "ffff"
  ) {
    return null;
  }
  const hi = Number.parseInt(hextets[6], 16);
  const lo = Number.parseInt(hextets[7], 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isPublicIPv6(address: string): boolean {
  if (net.isIP(address) !== 6) return false;

  // IPv4-mapped (any compression / case): apply IPv4 policy to the embedded address.
  const mapped = extractMappedIPv4(address);
  if (mapped !== null) {
    return isPublicIPv4(mapped);
  }

  // Unspecified / loopback / ULA / link-local / multicast via BlockList ranges.
  // BlockList normalizes IPv6 forms itself (expanded, uppercase, etc.).
  const list = new net.BlockList();
  list.addAddress("::", "ipv6");
  list.addAddress("::1", "ipv6");
  list.addSubnet("fc00::", 7, "ipv6"); // ULA
  list.addSubnet("fe80::", 10, "ipv6"); // link-local
  list.addSubnet("ff00::", 8, "ipv6"); // multicast
  if (list.check(address, "ipv6")) return false;

  return true;
}

export function isPublicPushAddress(address: string, family: 4 | 6): boolean {
  if (typeof address !== "string" || address.length === 0) return false;
  if (family === 4) {
    if (net.isIP(address) !== 4) return false;
    return isPublicIPv4(address);
  }
  if (family === 6) {
    if (net.isIP(address) !== 6) return false;
    return isPublicIPv6(address);
  }
  return false;
}

const defaultResolveAll: ResolveAll = (hostname) =>
  new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(
        addresses.map(({ address, family }) => ({
          address,
          family: family as 4 | 6,
        })),
      );
    });
  });

function unsafeEndpoint(message = "Unsafe push endpoint"): never {
  throw new PushUnsafeEndpointError(message);
}

function validateAddressSet(
  results: Array<{ address: string; family: 4 | 6 }>,
): Array<{ address: string; family: 4 | 6 }> {
  if (!Array.isArray(results) || results.length === 0) {
    unsafeEndpoint("Unable to resolve push endpoint");
  }
  for (const entry of results) {
    if (
      !entry ||
      typeof entry.address !== "string" ||
      (entry.family !== 4 && entry.family !== 6) ||
      !isPublicPushAddress(entry.address, entry.family)
    ) {
      unsafeEndpoint("Unsafe push endpoint");
    }
  }
  return results;
}

function familyFilter(
  results: Array<{ address: string; family: 4 | 6 }>,
  family: number | undefined,
): Array<{ address: string; family: 4 | 6 }> {
  if (family === 4 || family === 6) {
    return results.filter((entry) => entry.family === family);
  }
  return results;
}

/**
 * Callback-style lookup for https.Agent that validates every A/AAAA answer
 * at the moment the socket is created (no separate preflight).
 */
export function createValidatedLookup(resolveAll: ResolveAll = defaultResolveAll): LookupFunction {
  const lookup: LookupFunction = (hostname, options, callback) => {
    let opts: dns.LookupOneOptions | dns.LookupAllOptions | number | undefined;
    let cb: (
      err: NodeJS.ErrnoException | null,
      address: string | dns.LookupAddress[],
      family?: number,
    ) => void;

    if (typeof options === "function") {
      cb = options as typeof cb;
      opts = undefined;
    } else {
      opts = options as dns.LookupOneOptions | dns.LookupAllOptions | number | undefined;
      cb = callback as typeof cb;
    }

    const optionsObject =
      typeof opts === "number"
        ? { family: opts }
        : opts && typeof opts === "object"
          ? opts
          : {};

    const wantAll = Boolean((optionsObject as { all?: boolean }).all);
    const familyOpt = (optionsObject as { family?: number }).family;
    const order = (optionsObject as { order?: string }).order;

    void Promise.resolve()
      .then(() => resolveAll(hostname))
      .then((raw) => {
        // Validate every A/AAAA answer first (mixed public/private is rejected),
        // then honor family/order for the address returned to the socket.
        const validated = validateAddressSet(raw);
        const filtered = familyFilter(validated, familyOpt);
        if (filtered.length === 0) {
          unsafeEndpoint("Unable to resolve push endpoint");
        }
        let ordered = filtered;
        if (order === "ipv4first") {
          ordered = [
            ...filtered.filter((entry) => entry.family === 4),
            ...filtered.filter((entry) => entry.family === 6),
          ];
        } else if (order === "ipv6first") {
          ordered = [
            ...filtered.filter((entry) => entry.family === 6),
            ...filtered.filter((entry) => entry.family === 4),
          ];
        }
        if (wantAll) {
          cb(null, ordered.map(({ address, family }) => ({ address, family })));
          return;
        }
        const first = ordered[0];
        cb(null, first.address, first.family);
      })
      .catch((error: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code === "PUSH_UNSAFE_ENDPOINT"
        ) {
          cb(error as NodeJS.ErrnoException, "", 0);
          return;
        }
        // Map unexpected resolver failures to a generic unsafe endpoint error.
        // Do not leak resolver/address detail to callers.
        const wrapped = new PushUnsafeEndpointError("Unable to resolve push endpoint");
        cb(wrapped, "", 0);
      });
  };

  return lookup;
}

export function createPushHttpsAgent(resolveAll?: ResolveAll): https.Agent {
  return new https.Agent({
    keepAlive: false,
    maxSockets: 8,
    lookup: createValidatedLookup(resolveAll),
  });
}

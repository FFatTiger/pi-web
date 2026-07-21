import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const WEB_AUTH_COOKIE = "pi_web_session";
export const WEB_AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const TOKEN_VERSION = "v1";
const SESSION_KEY_CONTEXT = "pi-web-session-v1";

export type SessionOptions = {
  now?: number;
  nonce?: string;
};

export type WebAuthCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

function safeEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function deriveKey(password: string): Buffer {
  return createHash("sha256").update(SESSION_KEY_CONTEXT).update("\0").update(password).digest();
}

function sign(payload: string, password: string): string {
  return createHmac("sha256", deriveKey(password)).update(payload).digest("base64url");
}

export function passwordsMatch(actual: string, expected: string): boolean {
  const left = createHash("sha256").update(actual).digest();
  const right = createHash("sha256").update(expected).digest();
  return safeEqual(left, right);
}

export function createSessionToken(password: string, options: SessionOptions = {}): string {
  const now = options.now ?? Date.now();
  const nonce = options.nonce ?? randomBytes(16).toString("base64url");
  const expiresAt = now + WEB_AUTH_MAX_AGE_SECONDS * 1000;
  const payload = `${TOKEN_VERSION}.${expiresAt}.${nonce}`;
  return `${payload}.${sign(payload, password)}`;
}

export function verifySessionToken(
  token: string | undefined,
  password: string,
  now: number = Date.now(),
): boolean {
  if (typeof token !== "string" || token.length === 0) return false;

  const parts = token.split(".");
  if (parts.length !== 4) return false;

  const [version, expiresAtRaw, nonce, signature] = parts;
  if (version !== TOKEN_VERSION) return false;
  if (!expiresAtRaw || !nonce || !signature) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;

  const payload = `${version}.${expiresAtRaw}.${nonce}`;
  const expected = sign(payload, password);

  try {
    const left = Buffer.from(signature, "base64url");
    const right = Buffer.from(expected, "base64url");
    return safeEqual(left, right);
  } catch {
    return false;
  }
}

export function getSessionCookieOptions(requestUrl: string): WebAuthCookieOptions {
  const secure = new URL(requestUrl).protocol === "https:";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: WEB_AUTH_MAX_AGE_SECONDS,
  };
}

export function getExpiredSessionCookieOptions(requestUrl: string): WebAuthCookieOptions {
  return {
    ...getSessionCookieOptions(requestUrl),
    maxAge: 0,
  };
}

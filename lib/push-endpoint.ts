function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function parseBasicPushEndpoint(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "endpoint") return null;

  const endpoint = value.endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0) return null;
  if (Buffer.byteLength(endpoint, "utf8") > 4096) return null;

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  } catch {
    return null;
  }

  return endpoint;
}

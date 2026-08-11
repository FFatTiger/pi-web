/**
 * Thin HTTP client for Host `/v1` resources.
 * No SSE constructors, no polling — live runtime traffic will use WS elsewhere.
 */

import { assertV1Path } from "./urls";

export class HttpError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: unknown;

  constructor(status: number, path: string, message: string, body?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.path = path;
    this.body = body;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpClientOptions {
  /** Called on 401 before the error is thrown. */
  onUnauthorized?: (path: string) => void;
  /** Optional credentials mode; gate cookies need include. */
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip onUnauthorized redirect hook (e.g. login form). */
  skipAuthRedirect?: boolean;
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(status: number, body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body) {
    const msg = (body as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  if (typeof body === "string" && body.trim()) return body;
  return fallback || `HTTP ${status}`;
}

export function createHttpClient(options: HttpClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const credentials = options.credentials ?? "include";

  async function request<T>(path: string, req: RequestOptions = {}): Promise<T> {
    assertV1Path(path);

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...req.headers,
    };

    let body: string | undefined;
    if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(req.body);
    }

    const requestInit: RequestInit = {
      method: req.method ?? "GET",
      headers,
      credentials,
      ...(body === undefined ? {} : { body }),
      ...(req.signal === undefined ? {} : { signal: req.signal }),
    };
    const response = await fetchImpl(path, requestInit);

    const text = await response.text();
    const parsed = parseBody(text);

    if (!response.ok) {
      if (response.status === 401 && !req.skipAuthRedirect) {
        options.onUnauthorized?.(path);
      }
      throw new HttpError(
        response.status,
        path,
        errorMessage(response.status, parsed, response.statusText),
        parsed,
      );
    }

    return parsed as T;
  }

  return {
    request,
    get: <T>(path: string, req?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...req, method: "GET" }),
    post: <T>(path: string, body?: unknown, req?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...req, method: "POST", body }),
    delete: <T>(path: string, req?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...req, method: "DELETE" }),
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;

/** Build `/login?next=` redirect target from current location. */
export function buildLoginRedirect(nextPath?: string): string {
  const next =
    nextPath ??
    (typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "/");
  const params = new URLSearchParams();
  // Avoid nesting login→login; bare /login has no useful return target.
  if (next && next !== "/login" && !next.startsWith("/login?")) {
    params.set("next", next);
  }
  const qs = params.toString();
  return qs ? `/login?${qs}` : "/login";
}

export function redirectToLogin(nextPath?: string): void {
  if (typeof window === "undefined") return;
  const target = buildLoginRedirect(nextPath);
  if (window.location.pathname === "/login") return;
  window.location.assign(target);
}

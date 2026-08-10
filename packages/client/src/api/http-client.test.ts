import { describe, expect, it, vi } from "vitest";
import {
  HttpError,
  buildLoginRedirect,
  createHttpClient,
} from "./http-client";

describe("HttpError", () => {
  it("flags 401", () => {
    const err = new HttpError(401, "/v1/gate/status", "Unauthorized");
    expect(err.isUnauthorized).toBe(true);
    expect(err.status).toBe(401);
  });

  it("does not flag other statuses", () => {
    expect(new HttpError(403, "/v1/x", "no").isUnauthorized).toBe(false);
  });
});

describe("createHttpClient", () => {
  it("rejects non-/v1 paths before fetch", async () => {
    const fetchImpl = vi.fn();
    const http = createHttpClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const legacy = ["", "api", "gate", "status"].join("/");
    await expect(http.get(legacy)).rejects.toThrow(/Only \/v1/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses JSON success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const http = createHttpClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(http.get<{ ok: boolean }>("/v1/gate/status")).resolves.toEqual({
      ok: true,
    });
  });

  it("throws HttpError and invokes onUnauthorized on 401", async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "need auth" }), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const http = createHttpClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onUnauthorized,
    });

    await expect(http.get("/v1/gate/status")).rejects.toMatchObject({
      name: "HttpError",
      status: 401,
      message: "need auth",
    });
    expect(onUnauthorized).toHaveBeenCalledWith("/v1/gate/status");
  });

  it("can skip auth redirect on login", async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("{}", { status: 401, statusText: "Unauthorized" }),
    );
    const http = createHttpClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onUnauthorized,
    });

    await expect(
      http.post("/v1/gate/login", { password: "x" }, { skipAuthRedirect: true }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe("buildLoginRedirect", () => {
  it("includes next when provided", () => {
    expect(buildLoginRedirect("/?session=a")).toBe("/login?next=%2F%3Fsession%3Da");
  });

  it("omits next for /login itself", () => {
    expect(buildLoginRedirect("/login")).toBe("/login");
  });
});

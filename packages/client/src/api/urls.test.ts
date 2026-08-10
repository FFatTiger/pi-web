import { describe, expect, it } from "vitest";
import { assertV1Path, urls, v1Url } from "./urls";

describe("v1Url", () => {
  it("builds /v1 paths", () => {
    expect(v1Url("gate", "status")).toBe("/v1/gate/status");
    expect(urls.gate.login()).toBe("/v1/gate/login");
    expect(urls.sessions.byId("a/b")).toBe("/v1/sessions/a%2Fb");
  });
});

describe("assertV1Path", () => {
  it("accepts /v1 and nested paths", () => {
    expect(() => assertV1Path("/v1")).not.toThrow();
    expect(() => assertV1Path("/v1/gate/status")).not.toThrow();
  });

  it("rejects non-/v1 paths including legacy route handlers", () => {
    const legacy = ["", "api", "gate", "status"].join("/");
    expect(() => assertV1Path(legacy)).toThrow(/Only \/v1/);
    expect(() => assertV1Path("/v2/x")).toThrow(/Only \/v1/);
    expect(() => assertV1Path("v1/gate")).toThrow(/Only \/v1/);
  });
});

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
  it("accepts /v1", () => {
    expect(() => assertV1Path("/v1/gate/status")).not.toThrow();
  });

  it("rejects legacy route-handler paths", () => {
    const legacy = ["", "api", "gate", "status"].join("/");
    expect(() => assertV1Path(legacy)).toThrow(/Only \/v1/);
  });
});

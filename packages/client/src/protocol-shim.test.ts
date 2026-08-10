import { describe, expect, it } from "vitest";
import {
  DEFAULT_READONLY_CAPABILITIES,
  hasCapability,
  isAgentEnabled,
} from "./protocol-shim";

describe("capability gating", () => {
  it("defaults to readonly (no agent)", () => {
    expect(isAgentEnabled(DEFAULT_READONLY_CAPABILITIES)).toBe(false);
    expect(hasCapability(DEFAULT_READONLY_CAPABILITIES, "files")).toBe(true);
  });

  it("detects agent capability", () => {
    expect(isAgentEnabled(["agent", "files"])).toBe(true);
    expect(hasCapability(["files.write"], "files.write")).toBe(true);
    expect(hasCapability(["files"], "files.write")).toBe(false);
  });

  it("handles undefined capabilities as disabled", () => {
    expect(isAgentEnabled(undefined)).toBe(false);
    expect(hasCapability(undefined, "agent")).toBe(false);
  });
});

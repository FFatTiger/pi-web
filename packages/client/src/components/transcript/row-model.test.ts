import { describe, expect, it } from "vitest";
import {
  buildTranscriptRows,
  createDemoTranscriptMessages,
  estimateRowHeight,
  getTranscriptRowKey,
} from "./row-model";

describe("buildTranscriptRows", () => {
  it("maps messages to rows with stable ids", () => {
    const rows = buildTranscriptRows([
      { id: "m1", role: "user", text: "hi" },
      { id: "m2", role: "assistant", text: "hello" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["m1", "m2"]);
    expect(rows.map((r) => r.kind)).toEqual(["user", "assistant"]);
  });

  it("prepends readonly banner when requested", () => {
    const rows = buildTranscriptRows([{ id: "m1", role: "user", text: "x" }], {
      readonlyBanner: true,
    });
    expect(rows[0]?.id).toBe("row:system:readonly");
    expect(rows[0]?.kind).toBe("system");
    expect(rows).toHaveLength(2);
  });
});

describe("estimateRowHeight", () => {
  it("uses explicit estimate when present", () => {
    expect(
      estimateRowHeight({ id: "a", kind: "user", text: "x", estimateHeight: 120 }),
    ).toBe(120);
  });

  it("grows with long text", () => {
    const short = estimateRowHeight({ id: "a", kind: "assistant", text: "hi" });
    const long = estimateRowHeight({
      id: "b",
      kind: "assistant",
      text: "word ".repeat(200),
    });
    expect(long).toBeGreaterThan(short);
  });
});

describe("createDemoTranscriptMessages", () => {
  it("returns welcome when no session", () => {
    const msgs = createDemoTranscriptMessages(undefined);
    expect(msgs[0]?.role).toBe("system");
  });

  it("returns multi-row demo for a session id", () => {
    const msgs = createDemoTranscriptMessages("demo-session-alpha");
    expect(msgs.length).toBeGreaterThan(2);
    expect(msgs.every((m) => m.id.includes("demo-session-alpha"))).toBe(true);
  });
});

describe("getTranscriptRowKey", () => {
  it("uses row id", () => {
    expect(
      getTranscriptRowKey({ id: "row:1", kind: "user", text: "a" }),
    ).toBe("row:1");
  });
});

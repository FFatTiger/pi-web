import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ExtensionUiRequestSchema,
  ImageAttachmentSchema,
  ImageContentSourceSchema,
  MAX_IMAGE_BASE64_LENGTH,
  RuntimeAttachParamsSchema,
  RuntimeCommandSchema,
  RuntimeEventSchema,
  RuntimeSnapshotSchema,
  SessiondPushSnapshotSchema,
  StreamingMessageLifecycleSchema,
  WsClientMessageSchema,
  WsHostMessageSchema,
  WsInterruptExchangeSchema,
} from "../dist/index.js";

const error = { code: "unavailable", message: "closed", retryable: false };
const idleState = {
  sessionId: "s-1", isStreaming: false, isPromptRunning: false,
  isBashRunning: false, isCompacting: false, model: null, messageCount: 0,
};
const fullSnapshot = {
  sessionId: "s-1", cwd: "/project", projectRoot: "/project",
  state: idleState,
  capabilities: { capabilities: [], version: 0 },
};

describe("A: cwd authority and create/attach separation", () => {
  it("accepts explicit create and existing-session attach, rejects mixed forms", () => {
    assert.equal(WsClientMessageSchema.safeParse({
      type: "create", id: "req-create", payload: { createRequestId: "create-1", cwd: "/project", projectRoot: "/project", thinkingLevel: "high", thinkingLevelPinned: true, toolNames: [] },
    }).success, true);
    assert.equal(WsClientMessageSchema.safeParse({ type: "attach", id: "req-attach", payload: { sessionId: "s-1" } }).success, true);
    assert.equal(WsClientMessageSchema.safeParse({ type: "attach", id: "req", payload: { sessionId: "s-1", createRequestId: "x", cwd: "/project" } }).success, false);
    assert.equal(WsClientMessageSchema.safeParse({ type: "create", id: "req", payload: { createRequestId: "x", cwd: "/project" } }).success, false);
  });

  it("requires epoch and lastEventId atomically", () => {
    assert.equal(RuntimeAttachParamsSchema.safeParse({ sessionId: "s" }).success, true);
    assert.equal(RuntimeAttachParamsSchema.safeParse({ sessionId: "s", epoch: "e", lastEventId: 0 }).success, true);
    assert.equal(RuntimeAttachParamsSchema.safeParse({ sessionId: "s", epoch: "e" }).success, false);
    assert.equal(RuntimeAttachParamsSchema.safeParse({ sessionId: "s", lastEventId: 0 }).success, false);
  });

  for (const resumeStatus of ["snapshot", "gap", "epoch_changed"]) {
    it(`full ${resumeStatus} snapshot restores cwd/projectRoot`, () => {
      const frame = {
        type: "snapshot",
        payload: { sessionId: "s-1", cwd: "/project", projectRoot: "/project", epoch: "e-2", lastEventId: 0, workerStatus: "ready", resumeStatus, snapshot: fullSnapshot },
      };
      assert.equal(WsHostMessageSchema.safeParse(frame).success, true);
      assert.equal(SessiondPushSnapshotSchema.safeParse({ ...frame.payload, type: "snapshot" }).success, true);
      assert.equal(WsHostMessageSchema.safeParse({ ...frame, payload: { ...frame.payload, cwd: "/other" } }).success, false);
      assert.equal(WsHostMessageSchema.safeParse({ ...frame, payload: { ...frame.payload, snapshot: { ...fullSnapshot, projectRoot: "/other" } } }).success, false);
    });
  }
});

describe("B: streaming correlation and snapshot invariants", () => {
  it("distinguishes interleaved streams and rejects missing IDs or empty deltas", () => {
    const update = (streamId, messageId, text) => ({ type: "message_update", eventId: 1, epoch: "e", sessionId: "s-1", streamId, messageId, delta: { role: "assistant", delta: { type: "text", text } } });
    assert.equal(RuntimeEventSchema.safeParse(update("stream-a", "msg-a", "A")).success, true);
    assert.equal(RuntimeEventSchema.safeParse(update("stream-b", "msg-b", "B")).success, true);
    assert.equal(RuntimeEventSchema.safeParse({ ...update("stream-a", "msg-a", "A"), streamId: undefined }).success, false);
    assert.equal(RuntimeEventSchema.safeParse({ ...update("stream-a", "msg-a", "A"), delta: { role: "assistant" } }).success, false);
    assert.equal(RuntimeEventSchema.safeParse({ ...update("stream-a", "msg-a", "A"), delta: { role: "toolResult" } }).success, false);
    assert.equal(RuntimeEventSchema.safeParse({ ...update("stream-a", "msg-a", "A"), delta: { role: "custom" } }).success, false);
    assert.equal(RuntimeEventSchema.safeParse({ ...update("stream-a", "msg-a", "A"), delta: { role: "bashExecution" } }).success, false);
    assert.equal(StreamingMessageLifecycleSchema.safeParse([
      { type: "message_start", sessionId: "s-1", streamId: "stream-a", messageId: "msg-a", message: { role: "assistant", content: [{ type: "text", text: "A" }] } },
      { type: "message_update", sessionId: "s-1", streamId: "stream-b", messageId: "msg-a", delta: { role: "assistant", delta: { type: "text", text: "B" } } },
      { type: "message_end", sessionId: "s-1", streamId: "stream-a", messageId: "msg-a", message: { role: "assistant", content: [], model: "m", provider: "p" } },
    ]).success, false);
  });

  it("rejects contradictory snapshot projections", () => {
    const active = {
      ...fullSnapshot,
      state: { ...idleState, isStreaming: true },
      streaming: { active: true, streamId: "stream", messageId: "msg", phase: "streaming", partialMessage: { role: "assistant", content: [{ type: "text", text: "part" }] } },
    };
    assert.equal(RuntimeSnapshotSchema.safeParse(active).success, true);
    assert.equal(RuntimeSnapshotSchema.safeParse({ ...active, state: { ...active.state, sessionId: "other" } }).success, false);
    assert.equal(RuntimeSnapshotSchema.safeParse({ ...active, streaming: { ...active.streaming, partialMessage: { role: "assistant" } } }).success, false);
    assert.equal(RuntimeSnapshotSchema.safeParse({ ...active, streaming: { active: true, phase: "streaming" } }).success, false);
    assert.equal(RuntimeSnapshotSchema.safeParse({ ...fullSnapshot, streaming: { active: false, streamId: "stale", messageId: "stale", partialMessage: { role: "assistant", content: [{ type: "text", text: "x" }] } } }).success, false);
    assert.equal(RuntimeSnapshotSchema.safeParse({ ...fullSnapshot, state: { ...idleState, isBashRunning: true } }).success, false);
    assert.equal(RuntimeSnapshotSchema.safeParse({ ...fullSnapshot, state: { ...idleState, bash: { command: "x", output: "", excludeFromContext: false, truncated: false, cancelled: false, completed: false, updateCount: 0 } } }).success, false);
    assert.equal(RuntimeSnapshotSchema.safeParse({ ...fullSnapshot, state: { ...idleState, bash: { command: "x", output: "done", excludeFromContext: false, truncated: false, cancelled: false, completed: true, exitCode: 0, updateCount: 1 } } }).success, true);
    assert.equal(RuntimeSnapshotSchema.safeParse({ ...fullSnapshot, state: { ...idleState, isCompacting: true } }).success, false);
  });
});

describe("C: extension method/response binding", () => {
  const validRequests = [
    { id: "1", method: "select", title: "Pick", options: ["a"] },
    { id: "2", method: "confirm", title: "Sure", message: "Continue?" },
    { id: "3", method: "input", title: "Input" },
    { id: "4", method: "editor", title: "Edit" },
    { id: "5", method: "notify", message: "Done", notifyType: "info" },
    { id: "6", method: "setStatus", statusKey: "k" },
    { id: "7", method: "setWidget", widgetKey: "w" },
    { id: "8", method: "setTitle", title: "T" },
    { id: "9", method: "set_editor_text", text: "x" },
    { id: "10", method: "custom", lines: ["x"] },
  ];
  it("accepts every request method and rejects cross-method fields", () => {
    for (const request of validRequests) assert.equal(ExtensionUiRequestSchema.safeParse(request).success, true, request.method);
    assert.equal(ExtensionUiRequestSchema.safeParse({ id: "x", method: "confirm", title: "T", message: "M", options: ["bad"] }).success, false);
    assert.equal(ExtensionUiRequestSchema.safeParse({ id: "x", method: "select", title: "T", options: ["a"], confirmed: true }).success, false);
  });
  it("binds each response kind and rejects wrong method/input path", () => {
    const command = (value) => RuntimeCommandSchema.safeParse({ type: "extension_ui_response", commandId: "c", id: "ui", ...value }).success;
    assert.equal(command({ method: "select", responseKind: "selected", selected: "a" }), true);
    assert.equal(command({ method: "confirm", responseKind: "confirmed", confirmed: false }), true);
    assert.equal(command({ method: "input", responseKind: "value", value: "x" }), true);
    assert.equal(command({ method: "editor", responseKind: "cancelled", cancelled: true }), true);
    assert.equal(command({ method: "confirm", responseKind: "value", value: "x" }), false);
    assert.equal(command({ method: "select", responseKind: "confirmed", confirmed: true }), false);
    assert.equal(RuntimeCommandSchema.safeParse({ type: "extension_ui_input", commandId: "c", id: "ui", method: "confirm", data: "x" }).success, false);
    for (const method of ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]) {
      assert.equal(command({ method, responseKind: "cancelled", cancelled: true }), false, method);
      assert.equal(RuntimeCommandSchema.safeParse({ type: "extension_ui_input", commandId: "c", id: "ui", method, data: "x" }).success, false, method);
    }
  });
});

describe("D: image validation", () => {
  it("accepts canonical supported images", () => {
    assert.equal(ImageAttachmentSchema.safeParse({ type: "image", data: "AA==", mimeType: "image/png" }).success, true);
    assert.equal(ImageContentSourceSchema.safeParse({ type: "url", url: "https://example.com/image.png", media_type: "image/png" }).success, true);
  });
  it("rejects malformed/oversized base64 and unsupported media types", () => {
    for (const data of ["", "A", "AAA", "A===", "AA=A", "!!!!", "AAAA=", "AB==", "AAB="]) assert.equal(ImageAttachmentSchema.safeParse({ type: "image", data, mimeType: "image/png" }).success, false, data);
    assert.equal(ImageAttachmentSchema.safeParse({ type: "image", data: "A".repeat(MAX_IMAGE_BASE64_LENGTH + 4), mimeType: "image/png" }).success, false);
    assert.equal(ImageAttachmentSchema.safeParse({ type: "image", data: "AA==", mimeType: "text/plain" }).success, false);
    assert.equal(ImageContentSourceSchema.safeParse({ type: "base64", data: "AA==", media_type: "text/plain" }).success, false);
    assert.equal(ImageContentSourceSchema.safeParse({ type: "url", url: `https://example.com/${"a".repeat(9_000)}` }).success, false);
  });
  it("rejects relative and dangerous image URLs", () => {
    for (const url of ["/relative.png", "javascript:alert(1)", "file:///tmp/a", "data:image/png;base64,AA==", "ftp://example.com/a", "https://user:pass@example.com/a.png"]) assert.equal(ImageContentSourceSchema.safeParse({ type: "url", url }).success, false, url);
  });
});

describe("E: browser WS independent interrupt", () => {
  it("parses explicit interrupt and correlated result", () => {
    const request = { type: "interrupt", id: "req-1", payload: { sessionId: "s-1", commandId: "cmd-1", interrupt: { type: "abort" } } };
    assert.equal(WsClientMessageSchema.safeParse(request).success, true);
    const response = { type: "interrupt_result", id: "req-1", payload: { sessionId: "s-1", commandId: "cmd-1", interruptType: "abort", result: { ok: false, type: "abort", error } } };
    assert.equal(WsHostMessageSchema.safeParse(response).success, true);
    assert.equal(WsInterruptExchangeSchema.safeParse({ request, response }).success, true);
    assert.equal(WsInterruptExchangeSchema.safeParse({ request, response: { ...response, id: "other" } }).success, false);
    assert.equal(WsInterruptExchangeSchema.safeParse({ request, response: { ...response, payload: { ...response.payload, commandId: "other" } } }).success, false);
    assert.equal(WsInterruptExchangeSchema.safeParse({ request, response: { ...response, payload: { ...response.payload, sessionId: "other" } } }).success, false);
    assert.equal(WsHostMessageSchema.safeParse({ ...response, payload: { ...response.payload, interruptType: "abort_bash" } }).success, false);
  });
  it("rejects unknown interrupts and abort-family ordinary commands", () => {
    assert.equal(WsClientMessageSchema.safeParse({ type: "interrupt", id: "r", payload: { sessionId: "s", commandId: "c", interrupt: { type: "prompt" } } }).success, false);
    for (const type of ["abort", "abort_compaction", "abort_bash", "clear_queue"]) assert.equal(WsClientMessageSchema.safeParse({ type: "command", payload: { sessionId: "s", command: { type, commandId: "c" } } }).success, false, type);
  });
});

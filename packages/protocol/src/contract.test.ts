import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_HOST_CAPABILITIES,
  HostCapabilitySchema,
  ImageAttachmentSchema,
  ModelRefSchema,
  PROTOCOL_VERSION,
  ProtocolErrorSchema,
  ProtocolHandshakeRequestSchema,
  ProtocolHandshakeResponseSchema,
  RUNTIME_COMMAND_TYPES,
  RuntimeCommandSchema,
  RuntimeEventSchema,
  RuntimeSnapshotSchema,
  SessionCreateParamsSchema,
  SessiondRpcRequestSchema,
  SessiondRpcResponseSchema,
  ThinkingLevelSchema,
  WorkerIpcRequestSchema,
  WorkerIpcResponseSchema,
  WsClientMessageSchema,
  WsHostMessageSchema,
  parseRuntimeCommand,
  safeParseRuntimeCommand,
  safeParseRuntimeEvent,
  safeParseRuntimeSnapshot,
  safeParseSessiondRpcResponse,
  safeParseWsClientMessage,
  safeParseWsHostMessage,
} from "./index.js";

function roundTrip<T>(
  schema: { parse: (v: unknown) => T; safeParse: (v: unknown) => unknown },
  value: unknown,
): T {
  const parsed = schema.parse(value);
  const json = JSON.parse(JSON.stringify(parsed)) as unknown;
  return schema.parse(json);
}

describe("protocol version", () => {
  it("freezes protocolVersion at 1", () => {
    assert.equal(PROTOCOL_VERSION, 1);
  });

  it("rejects non-v1 handshake", () => {
    const result = ProtocolHandshakeRequestSchema.safeParse({
      protocolVersion: 2,
      client: { shell: "web", platform: "mac" },
      features: [],
    });
    assert.equal(result.success, false);
  });
});

describe("capabilities", () => {
  it("covers the full negotiated capability set", () => {
    const expected = [
      "agent",
      "files",
      "files.write",
      "files.watch",
      "files.upload",
      "git",
      "worktree",
      "session.write",
      "session.delete",
      "models",
      "models.configure",
      "auth.providers",
      "skills",
      "skills.manage",
      "plugins",
      "plugins.manage",
      "project.trust",
      "export",
    ];
    assert.deepEqual([...ALL_HOST_CAPABILITIES].sort(), [...expected].sort());
    for (const cap of expected) {
      assert.equal(HostCapabilitySchema.parse(cap), cap);
    }
  });

  it("rejects unknown capabilities", () => {
    assert.equal(HostCapabilitySchema.safeParse("desktop").success, false);
  });
});

describe("handshake round-trip", () => {
  it("parses request and response", () => {
    const req = roundTrip(ProtocolHandshakeRequestSchema, {
      protocolVersion: 1,
      client: { shell: "pwa", platform: "ios" },
      features: ["virtual-scroll"],
      auth: "gate-token",
    });
    assert.equal(req.protocolVersion, 1);
    assert.equal(req.client.shell, "pwa");

    const res = roundTrip(ProtocolHandshakeResponseSchema, {
      protocolVersion: 1,
      host: {
        mode: "lan",
        capabilities: ["agent", "files", "files.write", "git", "worktree"],
      },
      limits: { maxUpload: 10_485_760, maxOpenSessions: 8 },
      sessionSnapshotSupport: true,
    });
    assert.equal(res.host.mode, "lan");
    assert.equal(res.sessionSnapshotSupport, true);
  });
});

describe("RuntimeCommand", () => {
  const samples: Record<string, unknown> = {
    prompt: {
      type: "prompt",
      commandId: "c-prompt",
      message: "hello",
      images: [
        {
          type: "image",
          data: "aGVsbG8=",
          mimeType: "image/png",
        },
      ],
      streamingBehavior: "steer",
    },
    abort: { type: "abort", commandId: "c-abort" },
    get_state: { type: "get_state", commandId: "c-state" },
    set_model: {
      type: "set_model",
      commandId: "c-model",
      provider: "openai",
      modelId: "gpt-4.1",
    },
    fork: { type: "fork", commandId: "c-fork", entryId: "entry-1" },
    navigate_tree: {
      type: "navigate_tree",
      commandId: "c-nav",
      targetId: "leaf-1",
    },
    set_thinking_level: {
      type: "set_thinking_level",
      commandId: "c-think",
      level: "high",
    },
    compact: {
      type: "compact",
      commandId: "c-compact",
      customInstructions: "keep decisions",
    },
    set_session_name: {
      type: "set_session_name",
      commandId: "c-name",
      name: "My session",
    },
    get_session_stats: {
      type: "get_session_stats",
      commandId: "c-stats",
    },
    get_last_assistant_text: {
      type: "get_last_assistant_text",
      commandId: "c-last",
    },
    set_auto_compaction: {
      type: "set_auto_compaction",
      commandId: "c-ac",
      enabled: true,
    },
    clear_queue: { type: "clear_queue", commandId: "c-cq" },
    steer: {
      type: "steer",
      commandId: "c-steer",
      message: "stop",
    },
    follow_up: {
      type: "follow_up",
      commandId: "c-fu",
      message: "then do this",
    },
    get_tools: { type: "get_tools", commandId: "c-tools" },
    get_commands: { type: "get_commands", commandId: "c-cmds" },
    set_tools: {
      type: "set_tools",
      commandId: "c-set-tools",
      toolNames: ["read", "bash"],
      includeExtensionTools: false,
    },
    reload: { type: "reload", commandId: "c-reload" },
    abort_compaction: {
      type: "abort_compaction",
      commandId: "c-ab-c",
    },
    extension_ui_response: {
      type: "extension_ui_response",
      commandId: "c-ui-r",
      id: "ui-1",
      value: "ok",
    },
    extension_ui_input: {
      type: "extension_ui_input",
      commandId: "c-ui-i",
      id: "ui-2",
      data: "typed",
    },
    set_auto_retry: {
      type: "set_auto_retry",
      commandId: "c-retry",
      enabled: false,
    },
    bash: {
      type: "bash",
      commandId: "c-bash",
      command: "ls -la",
      excludeFromContext: true,
    },
    abort_bash: { type: "abort_bash", commandId: "c-ab-b" },
    generate_session_title: {
      type: "generate_session_title",
      commandId: "c-title",
    },
  };

  it("enumerates exactly 26 command types", () => {
    assert.equal(RUNTIME_COMMAND_TYPES.length, 26);
    assert.equal(Object.keys(samples).length, 26);
  });

  it("parses every command type with commandId", () => {
    for (const type of RUNTIME_COMMAND_TYPES) {
      const sample = samples[type];
      assert.ok(sample, `missing sample for ${type}`);
      const parsed = parseRuntimeCommand(sample);
      assert.equal(parsed.type, type);
      assert.ok(parsed.commandId.length > 0);
      const again = roundTrip(RuntimeCommandSchema, parsed);
      assert.equal(again.type, type);
    }
  });

  it("rejects unknown command type", () => {
    const result = safeParseRuntimeCommand({
      type: "teleport",
      commandId: "x",
    });
    assert.equal(result.success, false);
  });

  it("rejects commands missing commandId", () => {
    const result = safeParseRuntimeCommand({
      type: "prompt",
      message: "hi",
    });
    assert.equal(result.success, false);
  });

  it("rejects invalid thinking level", () => {
    const result = safeParseRuntimeCommand({
      type: "set_thinking_level",
      commandId: "c1",
      level: "ultra",
    });
    assert.equal(result.success, false);
  });

  it("rejects invalid model identity shape on set_model", () => {
    const result = safeParseRuntimeCommand({
      type: "set_model",
      commandId: "c1",
      // SDK Model objects must not be accepted; only provider/modelId strings.
      model: { id: "gpt", provider: "openai", contextWindow: 128000 },
    });
    assert.equal(result.success, false);
  });

  it("rejects image attachments without image/* mimeType", () => {
    assert.equal(
      ImageAttachmentSchema.safeParse({
        type: "image",
        data: "abc",
        mimeType: "application/pdf",
      }).success,
      false,
    );
    assert.equal(
      safeParseRuntimeCommand({
        type: "prompt",
        commandId: "c1",
        message: "x",
        images: [
          { type: "image", data: "abc", mimeType: "text/plain" },
        ],
      }).success,
      false,
    );
  });

  it("rejects toolNames that are not an array", () => {
    assert.equal(
      safeParseRuntimeCommand({
        type: "set_tools",
        commandId: "c1",
        toolNames: "read",
      }).success,
      false,
    );
  });
});

describe("RuntimeEvent envelope", () => {
  it("round-trips a message_update event", () => {
    const event = roundTrip(RuntimeEventSchema, {
      type: "message_update",
      eventId: "e-1",
      sessionId: "s-1",
      epoch: 0,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
        model: "gpt-4.1",
        provider: "openai",
      },
    });
    assert.equal(event.type, "message_update");
  });

  it("round-trips tool_execution_start with unknown args", () => {
    const event = roundTrip(RuntimeEventSchema, {
      type: "tool_execution_start",
      eventId: "e-2",
      sessionId: "s-1",
      epoch: 1,
      toolCallId: "tc-1",
      toolName: "bash",
      args: { command: "echo hi" },
    });
    assert.equal(event.type, "tool_execution_start");
  });

  it("rejects events missing eventId/sessionId/epoch", () => {
    assert.equal(
      safeParseRuntimeEvent({ type: "agent_start" }).success,
      false,
    );
  });
});

describe("RuntimeSnapshot", () => {
  it("round-trips snapshot with worker status and streaming projection", () => {
    const snapshot = roundTrip(RuntimeSnapshotSchema, {
      sessionId: "s-1",
      epoch: 3,
      lastEventId: "e-99",
      workerStatus: "busy",
      state: {
        sessionId: "s-1",
        isStreaming: true,
        isPromptRunning: true,
        isBashRunning: false,
        isCompacting: false,
        model: { id: "gpt-4.1", provider: "openai" },
        thinkingLevel: "medium",
        contextUsage: { percent: 42, tokens: 12000, contextWindow: 128000 },
        queuedMessages: { steering: [], followUp: ["later"] },
        extensionStatuses: [{ key: "status", text: "ok" }],
        extensionWidgets: [
          {
            key: "w1",
            lines: ["line"],
            placement: "aboveEditor",
          },
        ],
      },
      streaming: {
        active: true,
        phase: "streaming",
        toolCallIds: [],
      },
    });
    assert.equal(snapshot.epoch, 3);
    assert.equal(snapshot.workerStatus, "busy");
    assert.equal(snapshot.state.model?.id, "gpt-4.1");
  });

  it("rejects snapshots missing lastEventId", () => {
    assert.equal(
      safeParseRuntimeSnapshot({
        sessionId: "s",
        epoch: 0,
        workerStatus: "ready",
        state: {
          sessionId: "s",
          isStreaming: false,
          isPromptRunning: false,
          isBashRunning: false,
          isCompacting: false,
        },
      }).success,
      false,
    );
  });
});

describe("WS envelopes", () => {
  it("parses client attach with epoch/lastEventId and createRequestId", () => {
    const msg = roundTrip(WsClientMessageSchema, {
      type: "attach",
      id: "req-1",
      payload: {
        sessionId: "s-1",
        epoch: 2,
        lastEventId: "e-10",
        createRequestId: "create-1",
      },
    });
    assert.equal(msg.type, "attach");
    if (msg.type === "attach") {
      assert.equal(msg.payload.epoch, 2);
      assert.equal(msg.payload.createRequestId, "create-1");
    }
  });

  it("parses host snapshot and event messages", () => {
    const snap = roundTrip(WsHostMessageSchema, {
      type: "snapshot",
      payload: {
        sessionId: "s-1",
        epoch: 0,
        lastEventId: "e-0",
        workerStatus: "ready",
        resumeStatus: "snapshot",
        state: {
          sessionId: "s-1",
          isStreaming: false,
          isPromptRunning: false,
          isBashRunning: false,
          isCompacting: false,
        },
      },
    });
    assert.equal(snap.type, "snapshot");

    const evt = roundTrip(WsHostMessageSchema, {
      type: "event",
      payload: {
        type: "prompt_done",
        eventId: "e-1",
        sessionId: "s-1",
        epoch: 0,
      },
    });
    assert.equal(evt.type, "event");
  });

  it("parses runtime_unavailable", () => {
    const msg = roundTrip(WsHostMessageSchema, {
      type: "runtime_unavailable",
      payload: {
        sessionId: "s-1",
        error: {
          code: "runtime_unavailable",
          message: "worker crashed",
          retryable: true,
        },
      },
    });
    assert.equal(msg.type, "runtime_unavailable");
  });

  it("rejects invalid client envelope type", () => {
    assert.equal(
      safeParseWsClientMessage({ type: "snapshot", payload: {} }).success,
      false,
    );
  });
});

describe("sessiond RPC", () => {
  it("round-trips request and error response", () => {
    const req = roundTrip(SessiondRpcRequestSchema, {
      protocolVersion: 1,
      id: "rpc-1",
      method: "session.command",
      params: {
        sessionId: "s-1",
        command: {
          type: "abort",
          commandId: "c-1",
        },
      },
    });
    assert.equal(req.method, "session.command");

    const err = roundTrip(SessiondRpcResponseSchema, {
      id: "rpc-1",
      ok: false,
      error: {
        code: "not_found",
        message: "session missing",
      },
    });
    assert.equal(err.ok, false);
    if (!err.ok) {
      assert.equal(err.error.code, "not_found");
    }
  });

  it("requires createRequestId for session create payload", () => {
    assert.equal(
      SessionCreateParamsSchema.safeParse({
        cwd: "/tmp/project",
      }).success,
      false,
    );
    const ok = SessionCreateParamsSchema.parse({
      createRequestId: "cr-1",
      cwd: "/tmp/project",
    });
    assert.equal(ok.createRequestId, "cr-1");
  });

  it("rejects RPC error without code", () => {
    assert.equal(
      safeParseSessiondRpcResponse({
        id: "x",
        ok: false,
        error: { message: "boom" },
      }).success,
      false,
    );
  });
});

describe("worker IPC", () => {
  it("round-trips control request/response", () => {
    const req = roundTrip(WorkerIpcRequestSchema, {
      protocolVersion: 1,
      id: "w-1",
      method: "command",
      params: {
        command: { type: "get_state", commandId: "c-1" },
      },
    });
    assert.equal(req.method, "command");

    const res = roundTrip(WorkerIpcResponseSchema, {
      id: "w-1",
      ok: true,
      result: { commandId: "c-1", data: null },
    });
    assert.equal(res.ok, true);
  });
});

describe("DTO guards", () => {
  it("accepts thinking levels and model refs without SDK types", () => {
    for (const level of [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ] as const) {
      assert.equal(ThinkingLevelSchema.parse(level), level);
    }
    assert.deepEqual(
      ModelRefSchema.parse({ id: "m", provider: "p" }),
      { id: "m", provider: "p" },
    );
  });

  it("structures protocol errors", () => {
    const err = ProtocolErrorSchema.parse({
      code: "epoch_changed",
      message: "session epoch advanced",
      details: { expected: 1, actual: 2 },
      retryable: false,
    });
    assert.equal(err.code, "epoch_changed");
  });
});

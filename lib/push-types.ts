export type AgentNotificationResult = "success" | "error";

export type AgentNotificationPayloadV1 = {
  version: 1;
  id: string;
  kind: "agent";
  sessionId: string;
  result: AgentNotificationResult;
};

export type TestNotificationPayloadV1 = {
  version: 1;
  id: string;
  kind: "test";
};

export type NotificationPayloadV1 = AgentNotificationPayloadV1 | TestNotificationPayloadV1;

export type NotificationPresentation = {
  title: "Pi Agent Web";
  body: string;
  tag: string;
  url: string;
};

export type RunningEventsMessage =
  | { type: "connected"; connectionId: string }
  | { type: "running"; runningSessionIds: string[] }
  | { type: "notification"; notification: AgentNotificationPayloadV1 };

const ownKeysEqual = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const boundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export const isValidNotificationSessionId = (value: unknown): value is string =>
  boundedText(value, 256);

export function parseNotificationPayload(value: unknown): NotificationPayloadV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || !boundedText(item.id, 128)) return null;
  if (item.kind === "test") {
    return ownKeysEqual(item, ["version", "id", "kind"])
      ? { version: 1, id: item.id, kind: "test" }
      : null;
  }
  if (item.kind === "agent") {
    if (!ownKeysEqual(item, ["version", "id", "kind", "sessionId", "result"])) return null;
    if (!isValidNotificationSessionId(item.sessionId)) return null;
    if (item.result !== "success" && item.result !== "error") return null;
    return {
      version: 1,
      id: item.id,
      kind: "agent",
      sessionId: item.sessionId,
      result: item.result,
    };
  }
  return null;
}

export function getNotificationPresentation(payload: NotificationPayloadV1): NotificationPresentation {
  if (payload.kind === "test") {
    return {
      title: "Pi Agent Web",
      body: "Test notification delivered",
      tag: "pi-web-test",
      url: "/",
    };
  }
  const encoded = encodeURIComponent(payload.sessionId);
  return {
    title: "Pi Agent Web",
    body: payload.result === "success" ? "Agent run finished" : "Agent run failed",
    tag: `pi-web-agent-${encoded}-${payload.result}`,
    url: `/?session=${encoded}`,
  };
}

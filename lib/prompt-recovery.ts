import type { AgentMessage, UserMessage } from "@/lib/types";

function extractMessageText(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object"
        && (block as { type?: string }).type === "text"
        && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "")
    .filter(Boolean)
    .join("\n");
}

function imageSignature(block: unknown): string {
  if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "image") return "";
  const source = (block as { source?: unknown }).source;
  if (source && typeof source === "object") {
    const src = source as { type?: unknown; media_type?: unknown; data?: unknown; url?: unknown };
    return [
      src.type === "url" ? "url" : "base64",
      typeof src.media_type === "string" ? src.media_type : "",
      typeof src.data === "string" ? src.data : "",
      typeof src.url === "string" ? src.url : "",
    ].join(":");
  }
  const flat = block as { data?: unknown; mimeType?: unknown };
  return [
    "base64",
    typeof flat.mimeType === "string" ? flat.mimeType : "",
    typeof flat.data === "string" ? flat.data : "",
    "",
  ].join(":");
}

export function userMessageKey(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return JSON.stringify({ text: content, images: [] });
  if (!Array.isArray(content)) return JSON.stringify({ text: "", images: [] });
  return JSON.stringify({
    text: extractMessageText(message),
    images: content.map(imageSignature).filter(Boolean),
  });
}

function matchingUserMessageCount(messages: readonly AgentMessage[], key: string): number {
  return messages.reduce((count, message) => (
    message.role === "user" && userMessageKey(message) === key ? count + 1 : count
  ), 0);
}

export interface PromptRecoverySnapshot {
  runId: number;
  message: UserMessage;
  messageKey: string;
  previousMatchingMessages: number;
}

export function createPromptRecoverySnapshot(
  runId: number,
  message: UserMessage,
  existingMessages: readonly AgentMessage[],
): PromptRecoverySnapshot {
  const messageKey = userMessageKey(message);
  return {
    runId,
    message,
    messageKey,
    previousMatchingMessages: matchingUserMessageCount(existingMessages, messageKey),
  };
}

/** Restore only when the failed submission did not reach the session file. */
export function shouldRestoreFailedPrompt(
  snapshot: PromptRecoverySnapshot,
  persistedMessages: readonly AgentMessage[],
): boolean {
  return matchingUserMessageCount(persistedMessages, snapshot.messageKey)
    <= snapshot.previousMatchingMessages;
}

export function removeOptimisticPrompt(
  messages: readonly AgentMessage[],
  snapshot: PromptRecoverySnapshot,
): AgentMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role !== "user" || userMessageKey(last) !== snapshot.messageKey) {
    return [...messages];
  }
  return messages.slice(0, -1);
}

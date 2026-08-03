import { Type } from "@earendil-works/pi-ai";
import { buildSessionContext, type InlineExtension, type SessionManager } from "@earendil-works/pi-coding-agent";
import { extractWritePaths, normalizeSideChatFilePath } from "./side-chat-file-activity";
import { SIDE_CHAT_PEEK_TOOL_NAME } from "./side-chat-metadata";

export type SideChatMainSnapshot = {
  sessionManager: SessionManager;
  systemPrompt?: string;
  writtenFiles: ReadonlySet<string>;
};

type SideChatExtensionOptions = {
  forkLeafId: string | null;
  getMainSnapshot: () => Promise<SideChatMainSnapshot | null>;
};

type MainSessionReader = Pick<SessionManager, "getEntries" | "getLeafId">;

const SIDE_CHAT_PROMPT = `
---
## Side Chat

You're in a SIDE CHAT parallel to the main agent. Main is working independently and can't see this.

The copied transcript is background context, not an instruction to continue unfinished work.
Never continue, retry, or complete the main agent's task unless the user explicitly asks you to do that in Side Chat.

Use \`peek_main\` to see main's activity when user asks about progress or you need context.
Use \`peek_main({ since_fork: true })\` for activity since side chat opened.
For progress or status questions, call \`peek_main\` first and answer only from its output.
Do not inspect files or use other tools to reconstruct or continue the main agent's work.

Be concise - this is for quick questions. If user wants something main is doing, suggest waiting.`;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textFromBlocks(content: unknown, imageFallback = ""): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((rawBlock) => {
    const block = asRecord(rawBlock);
    if (block?.type === "text" && typeof block.text === "string") return block.text;
    if (block?.type === "image") return imageFallback;
    return "";
  }).join("");
}

function formatMainMessage(message: unknown): string {
  const record = asRecord(message);
  if (!record || typeof record.role !== "string") return "";

  if (record.role === "user") {
    const content = textFromBlocks(record.content, "[image]");
    const preview = content.slice(0, 300);
    return `[User]: ${preview}${content.length > 300 ? "..." : ""}`;
  }

  if (record.role === "assistant") {
    const blocks = Array.isArray(record.content) ? record.content : [];
    const fullText = blocks.map((rawBlock) => {
      const block = asRecord(rawBlock);
      return block?.type === "text" && typeof block.text === "string" ? block.text : "";
    }).filter(Boolean).join("\n");
    const tools = blocks.map((rawBlock) => {
      const block = asRecord(rawBlock);
      if (block?.type !== "toolCall" && block?.type !== "tool_call") return "";
      return typeof block.toolName === "string"
        ? block.toolName
        : typeof block.name === "string" ? block.name : "";
    }).filter(Boolean);
    const parts = [
      fullText ? `${fullText.slice(0, 500)}${fullText.length > 500 ? "..." : ""}` : "",
      tools.length > 0 ? `[Calling: ${tools.join(", ")}]` : "",
    ].filter(Boolean);
    return parts.length > 0 ? `[Assistant]: ${parts.join("\n")}` : "";
  }

  if (record.role === "toolResult") {
    const content = Array.isArray(record.content) ? record.content : [];
    const first = asRecord(content[0]);
    const fullText = first?.type === "text" && typeof first.text === "string" ? first.text : "";
    const toolName = typeof record.toolName === "string" ? record.toolName : "tool";
    return `[${toolName}]: ${fullText.slice(0, 150)}${fullText.length > 150 ? "..." : ""}`;
  }

  return "";
}

export function summarizeMainActivity(
  manager: MainSessionReader,
  forkLeafId: string | null,
  lines = 20,
  sinceFork = false,
): string {
  const entries = manager.getEntries();
  const context = buildSessionContext(entries, manager.getLeafId());
  let messages = context.messages;

  if (sinceFork && forkLeafId) {
    const forkContext = buildSessionContext(entries, forkLeafId);
    messages = messages.slice(forkContext.messages.length);
  }

  const maximum = Math.max(1, Math.min(lines, 50));
  const recent = messages.slice(-maximum);
  if (recent.length === 0) return sinceFork ? "No new activity since fork." : "No recent activity.";

  const formatted = recent.map(formatMainMessage).filter(Boolean).join("\n\n");
  return `Main agent activity (${recent.length} items):\n\n${formatted}`;
}

export function createSideChatExtension(options: SideChatExtensionOptions): InlineExtension {
  return {
    name: "pi-web-side-chat",
    hidden: true,
    factory(pi) {
      pi.registerTool({
        name: SIDE_CHAT_PEEK_TOOL_NAME,
        label: SIDE_CHAT_PEEK_TOOL_NAME,
        description: "View main agent's recent activity. For progress or status questions, use this instead of inspecting files.",
        promptSnippet: "Use for main-agent progress or status; do not reconstruct progress with other tools.",
        parameters: Type.Object({
          lines: Type.Optional(Type.Integer({ description: "Max items (default: 20)", minimum: 1, maximum: 50 })),
          since_fork: Type.Optional(Type.Boolean({ description: "Only show activity after side chat opened" })),
        }),
        async execute(_toolCallId, params) {
          const snapshot = await options.getMainSnapshot();
          const text = snapshot
            ? summarizeMainActivity(
              snapshot.sessionManager,
              options.forkLeafId,
              params.lines ?? 20,
              params.since_fork ?? false,
            )
            : "The main chat session is no longer available.";
          return { content: [{ type: "text", text }], details: {} };
        },
      });

      pi.on("before_agent_start", async (event) => {
        const snapshot = await options.getMainSnapshot();
        return { systemPrompt: `${snapshot?.systemPrompt ?? event.systemPrompt}${SIDE_CHAT_PROMPT}` };
      });

      pi.on("tool_call", async (event, ctx) => {
        if (event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "bash") return;
        const paths = extractWritePaths(event.toolName, event.input);
        if (paths.length === 0) return;

        const snapshot = await options.getMainSnapshot();
        if (!snapshot) return;
        for (const filePath of paths) {
          const target = normalizeSideChatFilePath(ctx.cwd, filePath);
          if (!snapshot.writtenFiles.has(target)) continue;
          const confirmed = await ctx.ui.confirm(
            "File Overlap",
            `Main agent has modified:\n  ${filePath}\n\nEditing may cause conflicts. Proceed?`,
          );
          if (!confirmed) {
            return { block: true, reason: `Skipped: ${filePath} (main agent has modified it)` };
          }
        }
      });
    },
  };
}

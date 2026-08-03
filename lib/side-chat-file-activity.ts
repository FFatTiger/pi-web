import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { isAbsolute, normalize, resolve } from "path";

/*
 * Shell tokenization and POSIX write-path extraction are adapted from
 * pi-side-chat v0.1.4, Copyright (c) 2026 Nico Bailon, under the MIT License.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

type SessionManagerLike = Pick<SessionManager, "getBranch" | "getCwd">;

type ToolCallBlockLike = {
  type?: string;
  name?: string;
  toolName?: string;
  arguments?: unknown;
  input?: unknown;
};

type MessageEntryLike = {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

type ShellToken =
  | { type: "word"; value: string }
  | { type: "op"; value: ">" | ">>" | "|" | "||" | "&" | "&&" | ";" };

declare global {
  var __piSideChatMainFileActivity: Map<string, Set<string>> | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getActivityRegistry(): Map<string, Set<string>> {
  if (!globalThis.__piSideChatMainFileActivity) {
    globalThis.__piSideChatMainFileActivity = new Map();
  }
  return globalThis.__piSideChatMainFileActivity;
}

export function normalizeSideChatFilePath(cwd: string, filePath: string): string {
  const absolute = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  const normalized = normalize(absolute);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function extractWritePaths(toolName: string, input: unknown): string[] {
  const record = asRecord(input) ?? {};
  if (toolName === "write" || toolName === "edit") {
    return typeof record.path === "string" && record.path.trim() ? [record.path] : [];
  }
  if (toolName === "bash" && typeof record.command === "string") {
    return parseShellWritePaths(record.command);
  }
  return [];
}

export function trackMainSessionToolCall(
  sessionId: string,
  cwd: string,
  toolName: string,
  input: unknown,
): void {
  const paths = extractWritePaths(toolName, input);
  if (paths.length === 0) return;

  const registry = getActivityRegistry();
  const written = registry.get(sessionId) ?? new Set<string>();
  for (const filePath of paths) {
    written.add(normalizeSideChatFilePath(cwd, filePath));
  }
  registry.set(sessionId, written);
}

export function collectMainMutatedFilePaths(manager: SessionManagerLike): Set<string> {
  const paths = new Set<string>();
  for (const entry of manager.getBranch() as MessageEntryLike[]) {
    if (entry.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) {
      continue;
    }
    for (const rawBlock of entry.message.content) {
      const block = rawBlock as ToolCallBlockLike;
      if (block.type !== "toolCall" && block.type !== "tool_call") continue;
      const name = typeof block.toolName === "string"
        ? block.toolName
        : typeof block.name === "string" ? block.name : "";
      const input = asRecord(block.input) ?? asRecord(block.arguments);
      if (!name || !input) continue;
      for (const filePath of extractWritePaths(name, input)) {
        paths.add(normalizeSideChatFilePath(manager.getCwd(), filePath));
      }
    }
  }
  return paths;
}

export function hydrateMainSessionFileActivity(sessionId: string, manager: SessionManagerLike): void {
  const historical = collectMainMutatedFilePaths(manager);
  if (historical.size === 0) return;
  const registry = getActivityRegistry();
  const written = registry.get(sessionId) ?? new Set<string>();
  for (const filePath of historical) written.add(filePath);
  registry.set(sessionId, written);
}

export function getMainSessionWrittenFiles(sessionId: string, manager?: SessionManagerLike): Set<string> {
  if (manager) hydrateMainSessionFileActivity(sessionId, manager);
  return new Set(getActivityRegistry().get(sessionId) ?? []);
}

function parseShellWritePaths(command: string): string[] {
  const tokens = tokenizeShell(command);
  const paths: string[] = [];
  let segment: ShellToken[] = [];

  for (const token of tokens) {
    if (token.type === "op" && isCommandSeparator(token.value)) {
      collectSegmentWritePaths(segment, paths);
      segment = [];
    } else {
      segment.push(token);
    }
  }
  collectSegmentWritePaths(segment, paths);
  return [...new Set(paths)];
}

function tokenizeShell(command: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  for (let i = 0; i < command.length;) {
    const char = command[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    const twoCharacterOperator = command.slice(i, i + 2);
    if (twoCharacterOperator === ">>" || twoCharacterOperator === "||" || twoCharacterOperator === "&&") {
      tokens.push({ type: "op", value: twoCharacterOperator });
      i += 2;
      continue;
    }
    if (char === ">" || char === "|" || char === "&" || char === ";") {
      tokens.push({ type: "op", value: char });
      i++;
      continue;
    }

    let value = "";
    while (i < command.length) {
      const current = command[i];
      if (/\s/.test(current) || current === ">" || current === "|" || current === "&" || current === ";") break;

      if (current === "\\") {
        const next = command[i + 1];
        if (next && (/\s/.test(next) || next === "'" || next === '"' || next === ">" || next === "|" || next === "&" || next === ";")) {
          value += next;
          i += 2;
        } else {
          value += current;
          i++;
        }
        continue;
      }

      if (current === "'") {
        i++;
        while (i < command.length && command[i] !== "'") value += command[i++];
        if (command[i] === "'") i++;
        continue;
      }

      if (current === '"') {
        i++;
        while (i < command.length && command[i] !== '"') {
          if (command[i] === "\\" && i + 1 < command.length && /["\\$`]/.test(command[i + 1])) {
            value += command[i + 1];
            i += 2;
          } else {
            value += command[i++];
          }
        }
        if (command[i] === '"') i++;
        continue;
      }

      value += current;
      i++;
    }
    if (value) tokens.push({ type: "word", value });
  }
  return tokens;
}

function collectSegmentWritePaths(segment: ShellToken[], paths: string[]): void {
  for (let index = 0; index < segment.length; index++) {
    const token = segment[index];
    if (token.type === "op" && (token.value === ">" || token.value === ">>")) {
      const target = segment[index + 1];
      if (target?.type === "word") {
        pushPath(paths, target.value);
        index++;
      }
    }
  }

  const commandIndex = segment.findIndex((token) => token.type === "word");
  if (commandIndex < 0) return;
  const commandToken = segment[commandIndex];
  if (commandToken.type !== "word") return;

  const commandName = commandToken.value.replace(/\.exe$/i, "").toLowerCase();
  const argumentTokens = segment.slice(commandIndex + 1);
  const operands = collectCommandOperands(argumentTokens);

  if (commandName === "tee" || commandName === "touch" || commandName === "rm") {
    for (const operand of operands) pushPath(paths, operand);
  } else if ((commandName === "cp" || commandName === "mv") && operands.length >= 2) {
    pushPath(paths, operands[operands.length - 1]);
  }

  collectPowerShellWritePaths(commandName, argumentTokens, operands, paths);
}

function collectPowerShellWritePaths(
  commandName: string,
  tokens: ShellToken[],
  operands: string[],
  paths: string[],
): void {
  const pathOptions = commandName === "out-file"
    ? ["filepath", "literalpath"]
    : commandName === "copy-item" || commandName === "move-item"
      ? ["destination"]
      : ["path", "literalpath"];
  const optionPaths = collectNamedOptionValues(tokens, pathOptions);

  if (["set-content", "add-content", "out-file", "new-item"].includes(commandName)) {
    const targets = optionPaths.length > 0 ? optionPaths : operands.slice(0, 1);
    for (const target of targets) pushPath(paths, target);
  } else if (commandName === "remove-item") {
    const targets = optionPaths.length > 0 ? optionPaths : operands;
    for (const target of targets) pushPath(paths, target);
  } else if (commandName === "copy-item" || commandName === "move-item") {
    const targets = optionPaths.length > 0 ? optionPaths : operands.slice(-1);
    for (const target of targets) pushPath(paths, target);
  }
}

function collectNamedOptionValues(tokens: ShellToken[], names: string[]): string[] {
  const accepted = new Set(names.map((name) => name.toLowerCase()));
  const values: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== "word" || !token.value.startsWith("-")) continue;
    const option = token.value.slice(1);
    const separator = option.search(/[:=]/);
    const name = (separator >= 0 ? option.slice(0, separator) : option).toLowerCase();
    if (!accepted.has(name)) continue;
    if (separator >= 0) {
      const inlineValue = option.slice(separator + 1);
      if (inlineValue) values.push(inlineValue);
    } else if (tokens[index + 1]?.type === "word") {
      values.push(tokens[index + 1].value);
      index++;
    }
  }
  return values;
}

function collectCommandOperands(tokens: ShellToken[]): string[] {
  const operands: string[] = [];
  let parsingOptions = true;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === "op") {
      if ((token.value === ">" || token.value === ">>") && tokens[index + 1]?.type === "word") index++;
      continue;
    }
    if (parsingOptions) {
      if (token.value === "--") {
        parsingOptions = false;
        continue;
      }
      if (token.value.startsWith("-")) continue;
      parsingOptions = false;
    }
    operands.push(token.value);
  }
  return operands;
}

function isCommandSeparator(value: ShellToken["value"]): boolean {
  return value === "|" || value === "||" || value === "&" || value === "&&" || value === ";";
}

function pushPath(paths: string[], filePath: string): void {
  if (filePath && !filePath.startsWith("-") && !isIgnoredWritePath(filePath)) paths.push(filePath);
}

function isIgnoredWritePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower === "nul"
    || filePath === "/dev/null"
    || filePath === "/dev/stdout"
    || filePath === "/dev/stderr"
    || filePath.startsWith("/dev/fd/");
}

import type {
  AgentSessionEvent,
  SessionManager,
  SettingsManager,
  SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface ModelLike {
  id: string;
  provider: string;
}

export interface ToolInfo {
  name: string;
  description: string;
}

export interface NavigateTreeResult {
  editorText?: string;
  cancelled: boolean;
  aborted?: boolean;
}

interface PromptTemplateLike {
  name: string;
  description?: string;
  sourceInfo: SlashCommandInfo["sourceInfo"];
}

interface SkillLike {
  name: string;
  description?: string;
  sourceInfo: SlashCommandInfo["sourceInfo"];
}

interface ResourceLoaderLike {
  getSkills(): { skills: SkillLike[] };
}

interface ExtensionRunnerLike {
  getRegisteredCommands(): Array<{
    invocationName: string;
    description?: string;
    sourceInfo: SlashCommandInfo["sourceInfo"];
  }>;
}

export interface AgentSessionLike {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly autoCompactionEnabled: boolean;
  readonly autoRetryEnabled: boolean;
  readonly model: ModelLike | undefined;
  readonly modelRegistry: { find: (provider: string, modelId: string) => ModelLike | undefined };
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  readonly agent: { state?: { systemPrompt?: string; thinkingLevel?: string } };
  readonly extensionRunner: ExtensionRunnerLike;
  readonly promptTemplates: readonly PromptTemplateLike[];
  readonly resourceLoader: ResourceLoaderLike;

  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string, options?: {
    images?: Array<{ type: "image"; data: string; mimeType: string }>;
    streamingBehavior?: "steer" | "followUp";
    source?: "interactive" | "rpc";
  }): Promise<void>;
  abort(): Promise<void>;
  setModel(model: ModelLike): Promise<void>;
  navigateTree(targetId: string, options?: { summarize?: boolean }): Promise<NavigateTreeResult>;
  setThinkingLevel(level: string): void;
  compact(customInstructions?: string): Promise<unknown>;
  setSessionName(name: string): void;
  getSessionStats(): unknown;
  getLastAssistantText(): string | undefined;
  setAutoCompactionEnabled(enabled: boolean): void;
  setAutoRetryEnabled(enabled: boolean): void;
  steer(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void>;
  followUp(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void>;
  getAllTools(): ToolInfo[];
  getActiveToolNames(): string[];
  setActiveToolsByName(names: string[]): void;
  abortCompaction(): void;
  getContextUsage(): ContextUsage | undefined;
}

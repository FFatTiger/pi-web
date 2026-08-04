# Explorer Side Chat 实施方案

## 技术决策

- Side Chat 原生集成在 `pi-web`，不安装或运行 `pi-side-chat`。
- 基础功能对齐 `pi-side-chat` v0.1.4；修正上游在主任务运行中复制未完成任务、可能导致 Side Agent 续做的问题。
- 使用独立、持久化的 AgentSession 和 SSE，主聊天与 Side Chat 可并行运行。
- 主会话历史只作为 Side Agent 的隐藏上下文；面板仅显示 Side Chat 创建后产生的消息。
- UI 位于 Explorer 右侧区域，复用 `ChatInput`、模型选择、thinking、图片、队列和停止能力。
- Close 仅隐藏面板，不中止生成；这是 Web 端明确保留的差异。

## 行为契约

| 操作 | 行为 |
|---|---|
| Open | 恢复活动 Side Chat；不存在时从主 session 稳定 leaf 分叉，运行中的当前任务不复制 |
| Close | 隐藏面板，保留消息、草稿、模式和运行状态 |
| Refork | 中止 Side Chat 当前任务，从主 session 最新稳定 leaf 重建，并重置为 Read-only |
| Clear | 中止 Side Chat 当前任务，创建空会话；模型、thinking、system prompt 和 fork 锚点来自主 session，并重置为 Read-only |
| Read-only | 启用 `read/grep/find/ls`、全部扩展/MCP tools 和 `peek_main` |
| Edit | 启用 coding tools、全部扩展/MCP tools 和 `peek_main` |

Refork/Clear 的旧 Side Chat 标记为非活动，不删除文件。模式切换、Refork 和 Clear 在 Side Chat 生成中仍可操作。

主会话运行时使用两个锚点：

- context leaf：本轮开始前的稳定 leaf，用于复制 Side Chat 初始上下文。
- activity leaf：打开时主会话当前 leaf，用作 `peek_main({ since_fork: true })` 的活动锚点。

Side prompt 明确将复制内容视为背景，不得续做主任务；进度/状态问题必须优先使用 `peek_main`，不得通过读文件重建主任务进度。

## 数据流

```text
SideChatPanel
  ├─ POST /api/side-chat ── Side Chat 创建、恢复、Refork、Clear、模式切换
  └─ useAgentSession ────── 独立 /api/agent/[id] + SSE

AgentSessionWrapper
  ├─ 主 session tool_execution_start ── 文件活动跟踪
  └─ Side session InlineExtension
       ├─ before_agent_start ── 主 system prompt + Side Chat prompt
       ├─ peek_main ─────────── 动态读取主 session 当前分支
       └─ tool_call ─────────── 写入重叠确认
```

## `peek_main`

参数与上游一致：

- `lines?: 1..50`，默认 20。
- `since_fork?: boolean`。

默认返回主 session 当前分支的最近消息；只有 `since_fork: true` 才返回 Side Chat 创建后的活动。摘要包含 user、assistant、tool call 和 tool result。

## 文件重叠保护

- 主 session 在 `tool_execution_start` 阶段记录 `write/edit/bash` 目标。
- 启动或恢复后扫描主 session 当前分支，恢复历史记录。
- Side Chat 在执行 `write/edit/bash` 前检查重叠并弹出确认。
- Bash 路径识别覆盖上游 POSIX 重定向及常用命令，并补充 PowerShell `Set-Content`、`Add-Content`、`Out-File`、`Remove-Item`、`Copy-Item`、`Move-Item` 等命令。
- Bash 分析是启发式冲突提示，不是文件系统安全边界。

## 代码位置

- `components/SideChatPanel.tsx`：面板、操作按钮、消息和输入区。
- `app/api/side-chat/route.ts`：控制面 API。
- `lib/side-chat-manager.ts`：Side Chat 生命周期和主从 session 绑定。
- `lib/side-chat-extension.ts`：prompt、`peek_main` 和冲突确认。
- `lib/side-chat-file-activity.ts`：主会话文件活动和 shell 路径提取。
- `lib/side-chat-metadata.ts`：持久化标记和工具模式。
- `lib/rpc-manager.ts`：独立 AgentSession、扩展注入和实时事件接入。

## 验证门禁

```text
node_modules/.bin/tsc --noEmit
npm run lint
npm test
npm run dev
```

开发验证不执行 `next build`。


## Codex alignment (2026-08)

1. **Multi side-chat tabs** — right panel uses `sidechat:{sessionId}` chips; `+` / shortcut mints a new tab.
2. **Ephemeral + TTL** — side chats are ephemeral by default; idle > 1h surfaces expired UI + recreate.
3. **No turn copy + boundary** — create empty session, inject `Side conversation boundary` custom message; use `peek_main` for main progress.
4. **Read-only default** — tools default to inspection-only; explicit Edit mode unlocks write/edit.
5. **Composer → Side Chat** — main `ChatInput` can send the current draft into a new side chat.

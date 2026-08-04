# Codex App 界面设计解构文档

> 基于 OpenAI Codex 桌面端（Electron + webview bundle）逆向梳理。  
> 目标：给 pi-web 对齐提供可执行的信息架构 / 布局 / 状态模型参考。  
> 范围：主窗口 UI 结构，不含底层 agent runtime 细节。

---

## 0. 一句话总览

Codex 桌面端不是“聊天页 + 侧边列表”，而是：

```text
工作台（Workbench）
├─ 左：组织系统（Sidebar）
├─ 中：对话线程（Thread）+ 输入台（Composer）
├─ 右：工作面板（Side Panel / Tabs：文件、Diff、Review、Browser…）
└─ 底：工具面板（Bottom Panel：Terminal 等）
```

核心心智：

1. **Thread 是中心实体**（不是“会话记录列表项”）
2. **Project 是组织维度**（workspace / cwd 归属）
3. **右侧面板是会话级工作区**（open files 按 conversation 存）
4. **Archive / Pin 是生命周期**，不是删文件

---

## 1. 应用壳层（App Shell）

### 1.1 主布局

```text
┌──────────────────────────────────────────────────────────────────────┐
│  Window Chrome / Title / OS controls                                 │
├──────────┬───────────────────────────────────────────┬───────────────┤
│          │  Thread Header / Toolbar                   │               │
│ Sidebar  │───────────────────────────────────────────│  Side Panel   │
│          │                                           │  (Tabs)       │
│  - New   │              Thread Timeline              │               │
│  - Pin   │         (messages / tools / diffs)        │  - Explorer   │
│  - Proj  │                                           │  - File       │
│  - Chat  │                                           │  - Review     │
│          │───────────────────────────────────────────│  - Browser    │
│          │              Composer                     │  - Artifact   │
│          │  (input + model + actions + queue loc)     │               │
├──────────┴───────────────────────────────────────────┴───────────────┤
│  Bottom Panel (optional): Terminal / logs / other                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 可切换面板

| 面板 | 命令 / 能力 | 说明 |
|---|---|---|
| Sidebar | `toggleSidebar` | 左栏组织导航 |
| Side Panel | `toggleSidePanel` / `toggleMaximizeSidePanel` | 右侧工作区 |
| Bottom Panel | `toggleBottomPanel` / `toggleTerminal` | 底部终端等 |
| Browser Panel | `toggleBrowserPanel` | 浏览器相关 |
| Review Tab | `openReviewTab` / `toggleReviewTab` | 代码审查视图 |
| File Tree | `toggleFileTreePanel` | 文件树 |
| Pinned Summary | `togglePinnedSummary` | 摘要钉住区 |

### 1.3 路由类型（routeKind）

Codex 用路由区分主内容形态：

| routeKind | 含义 |
|---|---|
| `home` | 首页 / 空态 / 新建入口 |
| `new-thread-panel` | 新建线程面板 |
| `local-thread` | 本地会话线程 |
| `client-local-thread` | 客户端本地线程 |
| `remote-thread` | 远程会话 |
| `chatgpt-thread` | ChatGPT 会话 |
| `other` | 非线程页（设置等） |

线程上下文（cwd / hostId / project）随 routeKind 解析，不是全局死绑一个 cwd。

---

## 2. 左侧边栏（Sidebar）——组织系统

### 2.1 信息架构（自上而下）

```text
[ 顶部操作 ]
  New chat
  搜索 / 快捷入口
  设置入口（部分在别处）

[ Pinned ]
  置顶 thread / 置顶 project

[ Custom Sections ]          ← 用户自定义分区（可多个）
  Section A
    threads / projects
  Section B
    ...

[ Projects ]
  Project Row (collapsed/expanded)
    Thread Row
    Thread Row
    Show all / Collapse
  Project Row
    ...

[ Chat / Projectless ]       ← 无仓库会话
  Thread Row
  ...

[ 可选入口 ]
  Archived（归档集合，默认不占主列表）
  Remote / Connection groups
```

### 2.2 一等实体

#### A. Project（项目）

- 绑定 workspace root / host
- 可本地 / 远程
- 可折叠
- 可拖拽排序
- 可 pin
- 可 remove from app（不删磁盘文件）
- 可 archive all chats

DOM/自动化属性（节选）：

- `sidebarProjectRow`
- `sidebarProjectId`
- `sidebarProjectLabel`
- `sidebarProjectCollapsed`
- `sidebarProjectShowAll`

#### B. Thread / Task（会话）

- 归属 project 或 projectless
- 可 pin / archive / rename
- 可 mark unread/read
- 可 open in new window
- 可 continue in new chat / new worktree
- 可 move to custom section

DOM/自动化属性（节选）：

- `sidebarThreadRow`
- `sidebarThreadId`
- `sidebarThreadHostId`
- `sidebarThreadKind`
- `sidebarThreadPinned`
- `sidebarThreadActive`
- `sidebarThreadTitle`

#### C. Custom Section（自定义分区）

- 用户创建/编辑/删除
- 会话可 Move to section
- 支持 bulk archive section chats
- 持久化键：`sidebar-custom-sections-v3`

#### D. Projectless（无项目会话）

- 一等状态，不是“临时目录副作用”
- 持久化：`projectless-thread-ids`
- UI 上类似“Chat / Temporary”集合

### 2.3 持久化状态键

| Key | 作用 |
|---|---|
| `project-order` | 项目顺序 |
| `pinned-project-ids` | 置顶项目 |
| `pinned-thread-ids` | 置顶会话 |
| `sidebar-project-thread-orders` | 项目内会话手动顺序 |
| `sidebar-thread-metadata` | 会话元数据（如 labelColor） |
| `projectless-thread-ids` | 无项目会话集合 |
| `sidebar-custom-sections-v3` | 自定义分区 |
| `connection-group-order` | 远程连接分组顺序 |
| `thread-project-assignments` | 会话→项目归属 |

### 2.4 排序与可见性规则

**项目顺序**

- 完全由 `PROJECT_ORDER` 控制
- 新项目 append 到末尾
- 不因最近活跃自动跳顶

**项目内会话**

- 可 manual order（`SIDEBAR_PROJECT_THREAD_ORDERS`）
- 可自动排序模式（`projectSortMode`）
- 默认折叠：先显示近期/状态优先项，其余 `Show all`

**状态优先级（展示）**

- running / unread / active 优先于普通历史
- pinned 提升到 Pinned 区，不混在普通列表顶部“假置顶”

### 2.5 生命周期：Pin / Archive

#### Pin

```text
thread/project ──pin──▶ 进入 Pinned 区
                ──unpin──▶ 回到原分区，尽量恢复相对位置
```

#### Archive（主清理路径）

```text
active ──archive──▶ archived（默认从主列表消失）
archived ──unarchive──▶ active（可 restorePinnedPosition）
```

- 会话级 archive
- 项目级 archive all chats
- 自定义分区 bulk archive
- **不是 hard delete 主路径**

### 2.6 项目/会话菜单能力矩阵

**项目菜单（典型）**

- New chat
- Reveal in Finder / Open in Explorer
- Archive all chats
- Remove project（移出 app，不删本地文件）
-（远程）Remove remote project

**会话菜单（典型）**

- Rename chat
- Pin / Unpin
- Archive chat
- Mark as unread / read
- Open in new window
- Continue in new chat
- Continue in new worktree
- Move to section
- Add / Edit scheduled task（自动化）

---

## 3. 中间主区：Thread + Composer

### 3.1 Thread（对话时间线）

#### 结构

```text
Thread Header
  - title / project badge
  - branch / worktree 信息（如有）
  - 工具入口（review / find / more）

Thread Timeline (virtualized)
  - user message
  - assistant message
  - reasoning / plan blocks
  - tool calls / command executions
  - diffs / file citations
  - queued follow-ups indicators

Navigation rail（用户消息导航）
  - 左侧 tick 时间线
  - hover 气泡预览
  - 点击跳转对应用户消息
```

#### 关键交互

- 虚拟列表滚动（长会话性能）
- 流式输出自动跟随（用户上滚应取消 follow）
- Find in thread
- Fork thread
- 多分支 / 历史回滚相关能力（产品层）
- 文件引用点击 → 打开右侧文件/diff

### 3.2 Composer（输入台）

Codex 的 Composer 是“行动控制台”，不只是 textarea。

```text
┌──────────────────────────────────────────────────────────┐
│  Queued messages (steering / follow-up)                  │
├──────────────────────────────────────────────────────────┤
│  Input (multiline)                                       │
│  attachments / @ mentions / browser tabs / images        │
├──────────────────────────────────────────────────────────┤
│  Utility / Action bar                                    │
│  [@] [+] [model] [reasoning] [plan] [worktree] [run loc] │
│                              [dictation] [voice] [send]  │
└──────────────────────────────────────────────────────────┘
```

#### Composer 能力清单

| 能力 | 说明 |
|---|---|
| Submit | 发送 |
| Steer / Follow-up queue | 运行中追加指令 |
| Model picker | 模型选择 |
| Reasoning effort | 推理强度调节（inc/dec/cycle） |
| Plan mode | 计划模式开关 |
| Worktree mode | worktree 运行模式 |
| Run location | 本地 / 远程 / 环境选择 |
| @ context | 文件/资源提及 |
| Add files / photos | 附件 |
| Capture appshot | 截图进上下文 |
| Dictation / Voice | 语音输入 |
| Context window usage | 可选显示上下文占用 |
| Enter behavior | Enter 发送 vs 换行可配置 |

#### Composer 设计原则

1. **发送区始终可达**（悬浮/固定在线程底部）
2. **运行态不锁死输入**（可 queue / steer）
3. **模型与执行环境是一等控件**
4. **上下文添加（@ / files / browser）是一等入口**

### 3.3 线程内“回到最新”

- 用户离开底部后出现 “scroll to latest”
- 显式点击才恢复 auto-follow
- 流式增长不得强行抢滚轮

---

## 4. 右侧 Side Panel（工作面板）

### 4.1 定位

右侧不是“全局文件浏览器残留”，而是：

> **当前 Thread 的工作台扩展面**

### 4.2 面板形态

| 形态 | 用途 |
|---|---|
| File Explorer / File Tree | 浏览工作区 |
| File Source Viewer | 读/预览源码 |
| Diff / Review | 变更审查 |
| Artifact Preview | 产物预览 |
| Browser / MCP app | 浏览器或扩展能力 |
| Docs / PDF / DOCX 等 | 富文件预览 |

### 4.3 Tab 系统（App Shell Tabs）

右侧是 tabbed side panel：

- 可多 tab
- 有 preview tab 概念（`isPreview`）
  - 预览态可被下一次预览替换
  - pin 后变成正式 tab
- 可关闭 / 重排 / 最大化
- 可 `openInSidePanel`

### 4.4 会话级 open files（关键）

Codex 按 conversation 存打开文件：

```ts
openFilesByConversationId: Map<conversationId, {
  openFiles: OpenFile[]
  reviewFiles: ReviewFile[]
  mcpResourcesByMcpAppId: Map<...>
}>
```

切换会话时：

1. 保存当前会话 open files / panel 状态
2. 恢复目标会话状态
3. 不把 A 的文件 tab 带到 B

这是与“全局 fileTabs”最关键的差异点。

### 4.5 文件打开路径

常见触发：

- 点消息里的文件引用
- 文件树点击（常以 `isPreview: true`）
- diff/review 行跳转
- 搜索结果打开
- 工具输出定位

打开后可：

- 预览
- pin
- 行级评论（review 场景）
- add selected text to chat
- reveal in folder
- open in external editor

---

## 5. 底部面板（Bottom Panel）

### 5.1 角色

- Terminal
- 运行输出 / 辅助工具
- 与主线程并行存在

### 5.2 交互

- `toggleBottomPanel`
- `toggleTerminal`
- 可与右侧面板并存
- 不替代 Composer

---

## 6. 顶层导航与全局命令

### 6.1 高频命令（产品层）

| 命令 | 语义 |
|---|---|
| New chat / New projectless task | 新建 |
| Open sidebar / Toggle sidebar | 导航 |
| Archive thread | 归档当前会话 |
| Toggle thread pin | 置顶 |
| Fork thread | 分叉 |
| Previous / Next thread | 会话切换 |
| Settings / MCP / Personality | 设置域 |
| Find in thread | 线程内查找 |
| Toggle side panel / bottom panel | 面板 |
| Open review tab | 审查 |

### 6.2 设置信息架构（侧翼）

设置是独立大域，不是塞进侧边栏底部一点点：

- General
- Appearance
- Agent
- Git / Worktrees
- MCP / Plugins / Skills / Hooks
- Browser use / Computer use
- Cloud / Remote connections
- Keyboard shortcuts
- Data controls / Usage
- Personalization / Memory
- Debug 等

---

## 7. 状态模型总图

```text                    ┌────────────────────┐
                    │   App Shell State  │
                    │ panels, widths,    │
                    │ routeKind, host    │
                    └─────────┬──────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
 ┌----------------┐  ┌----------------┐  ┌----------------┐
 │ Sidebar State  │  │ Thread State   │  │ Side Panel     │
 │ projects order │  │ messages       │  │ openFiles by   │
 │ pins archive   │  │ streaming      │  │ conversationId │
 │ sections       │  │ queue/steer    │  │ tabs/preview   │
 │ projectless    │  │ composer draft │  │ review/diff    │
 └----------------┘  └----------------┘  └----------------┘
          │                   │                   │
          └────────────┬──────┴─────────┬─────────┘
                       ▼                ▼
                Workspace Context   Host/Runtime
                cwd/root/git        local/remote
```

### 7.1 哪些状态按会话隔离

| 状态 | 是否会话级 | 说明 |
|---|---|---|
| messages / stream | 是 | 线程本体 |
| composer draft / queue | 是 | 输入与排队 |
| open files / review files | 是 | 右侧工作区 |
| side chat / side conversation | 是 | 侧边对话 |
| project order | 否 | 全局组织 |
| pinned ids | 否（全局集合） | 指向具体 thread/project |
| sidebar width | 否 | 布局偏好 |
| model defaults | 混合 | 全局默认 + 线程覆盖 |

---

## 8. 关键页面/模式拆解

### 8.1 Home

- Hero / 公告
- 新建入口
- 最近项目 / 建议
- Composer 可直接从 home 发起

### 8.2 Local Thread

- 完整三栏工作台
- 绑定 local project / cwd / worktree
- 可开 terminal / review / file panel

### 8.3 Remote / Cloud Thread

- host 切换
- 远程项目选择
- 权限与环境提示更重

### 8.4 Review Mode

- 以 diff 列表 + 文件源码为中心
- 可评论、跳转、批量处理
- 与 thread 双向联动

### 8.5 Quick Chat / Hotkey Window

- 轻量快速会话
- 可 projectless
- 不承担完整 workbench 复杂度

---

## 9. 视觉与交互语言（可对齐点）

### 9.1 布局语言

- 左侧窄导航，内容短名 + tooltip 全路径
- 中间宽阅读列（消息有 max width）
- 右侧工作区可 resize / maximize
- 表面层级：`main-surface` / border-token / muted text

### 9.2 行组件语言（Sidebar）

- 胶囊/圆角行
- hover 才出操作
- active 高对比
- 状态点：running / unread
- 拖拽：浮层预览 + 插入线

### 9.3 线程导航语言

- 左轨 tick（非右轨大纲）
- 邻近 tick 有长度衰减
- hover 单气泡预览，不占输入区宽度

### 9.4 Composer 语言

- 底部固定行动区
- 主按钮明确（send / stop）
- 次级能力收进 bar / menu，不堆一排同等按钮

---

## 10. 与 pi-web 的结构映射

| Codex | pi-web 现状 | 差距 |
|---|---|---|
| Sidebar 组织系统 | Projects + Temporary + 拖拽排序 | 缺 Pin / Archive / Custom sections |
| Thread + Navigation rail | ChatWindow + ChatMinimap（左轨） | 已部分对齐 |
| Composer action bar | ChatInput + SessionInfoBar | 能力更少，但仍是底部行动区 |
| Side Panel tabs | WorkspaceFilePanel + file tabs | 已有，但需会话级隔离（已开始做） |
| openFilesByConversationId | 原全局 fileTabs | 应对齐会话级（已推进） |
| Bottom terminal | 无完整对等 | 非第一优先级 |
| Archive lifecycle | hard delete 为主 | 心智不同 |
| Projectless | `pi-cwd-*` Temporary | 近似，未一等化 |

---

## 11. 对齐优先级（给实现用）

### P0 — 结构对齐（用户每天碰到）

1. 会话级右侧文件面板（A 的预览不带到 B）
2. 流式输出不抢滚轮
3. Sidebar：Pinned + Archive
4. 会话菜单主路径改为 Rename / Pin / Archive

### P1 — 组织对齐

5. 项目 Archive all
6. Remove project 语义（移出列表，不暗示删磁盘）
7. Temporary 明确为 Projectless
8. 项目/会话顺序稳定性（已修 partial hydrate 裁剪）

### P2 — 完整工作台

9. Custom sections
10. Review/Diff 作为一等 side tab
11. Bottom terminal
12. Continue in new worktree / open in new window

---

## 12. 推荐的目标信息架构（pi-web）

```text
AppShell
├─ SessionSidebar
│  ├─ Pinned
│  ├─ Projects
│  │   └─ ProjectGroup
│  │       └─ SessionItem[]
│  ├─ Temporary / Projectless
│  └─ Archived entry
├─ ChatWindow
│  ├─ Thread (messages + minimap rail)
│  └─ Composer (ChatInput + status)
└─ RightPanel
   ├─ Explorer
   ├─ File tabs (session-scoped)
   └─ Side Chat (session-scoped)
```

---

## 13. 设计原则清单（写代码时对照）

1. **Thread-centric**：中间线程是主叙事
2. **Organization ≠ Chronology**：侧边栏先组织，再时间
3. **Soft lifecycle first**：Archive 优先于 Delete
4. **Session-scoped workspace**：右侧文件/侧聊跟会话走
5. **Project-scoped execution**：cwd/worktree 跟项目走
6. **Non-blocking generation**：生成中可看历史、可 queue，不抢交互
7. **Progressive disclosure**：高级能力进菜单/面板，不堆主路径
8. **Stable order**：手动排序不被刷新/局部 hydrate 破坏

---

## 14. 附录：关键模块索引（源码侧）

> 名称来自桌面端 bundle，便于继续深挖。

- `thread-app-shell-chrome`
- `composer-utility-bar` / `composer-action-bar-*`
- `sidebarElectron.*` i18n / actions
- `localTaskRow.*`
- `sidebar-custom-sections-v3`
- `openFilesByConversationId` / review file source tabs
- `toggleSidePanel` / `toggleMaximizeSidePanel`
- `archive-thread` / `unarchive-thread` / `set-thread-pinned`
- routeKind: `home` / `local-thread` / `remote-thread` / `chatgpt-thread`

---

## 15. 结语

Codex App 的界面本质是：

> **以 Thread 为中心的开发工作台**  
> 左侧管“事如何组织”，中间管“事如何推进”，右侧管“事落到哪些文件/审查”，底部管“环境与终端”。

对齐 Codex，不应只抄皮肤，而应依次对齐：

1. 实体模型（Thread / Project / Projectless）
2. 生命周期（Pin / Archive）
3. 状态作用域（session-scoped panels）
4. 交互优先级（不抢滚轮、可 queue、可预览 pin）

---

文档版本：2026-08-04  
适用对象：pi-web Codex 对齐

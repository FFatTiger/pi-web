# 侧边栏多项目会话与工作区工具重构设计

日期：2026-07-21  
状态：待用户审核

## 1. 背景

当前侧边栏通过项目下拉框一次只显示一个项目的会话。服务端已经通过 `/api/agent/running/events` 推送所有正在运行的 session id，但侧边栏只在当前项目的会话行上呈现运行状态。因此多个目录同时执行任务时，其他目录的运行和完成状态不可见。

本次改造参考用户提供的截图，将左侧栏改为同时展示多个项目分组，并把低频的 Worktree 和文件浏览能力移出左侧栏，为跨项目状态提供持续可见的空间。

## 2. 目标

1. 左侧栏同时展示所有项目及其会话，支持多个项目独立展开。
2. 项目内任意会话运行时，即使项目折叠，也能在项目行看到运行状态。
3. 后台会话完成且尚未查看时，在项目行显示未读状态。
4. Worktree 选择器移到主窗口顶部工具栏，位于 `Full history` 左侧。
5. 文件浏览器移到右侧，与现有文件详情面板互斥使用同一展开区域。
6. 保留现有会话分叉树、重命名、删除、运行状态、未读状态、文件上传、文件刷新和 `@` 引用能力。
7. 不修改服务端 running SSE 协议，不引入不必要的后端聚合。

## 3. 非目标

本次不实现：

- 主机层级、主机名称、CPU 或 RAM 状态；
- 项目或会话搜索；
- 运行中会话数量；
- 运行项目自动置顶；
- 运行时自动展开项目；
- 多个右侧面板并排显示；
- 服务端持久化项目展开、未读或手动目录状态。

## 4. 总体布局

### 4.1 左侧栏

顶部只保留：

- `Pi Agent Web` 标题；
- 刷新会话按钮；
- 打开目录的文件夹按钮。

移除：

- 当前项目选择下拉框；
- 顶部 `New` 按钮；
- Worktree 选择器；
- 底部文件浏览器。

主体改为项目分组列表：

```text
项目目录 A                         +  ◌
  会话 A1                          1h ago
  会话 A2                          3h ago

项目目录 B                         +  ●
  会话 B1                          running
  会话 B2                          1d ago
```

每个项目行包含：

- 展开/折叠箭头；
- 项目目录名称或紧凑路径；
- 新建会话 `+`；
- 项目活动状态图标。

不显示项目的会话数量或运行数量。

### 4.2 主窗口顶部

顶部工具栏顺序调整为：

```text
侧边栏  主题  |  Worktree ▼  |  Full history  Branches  System ...
```

Worktree 控件位于 `Full history` 左侧，并跟随当前项目和当前有效 cwd 更新。

### 4.3 右侧区域

右上角固定放置两个相邻按钮：

```text
[文件浏览器] [文件详情]
```

两个按钮控制同一个右侧横向展开区域，状态为：

```ts
type RightPanelMode = "closed" | "explorer" | "file";
```

文件浏览器与文件详情互斥，不允许同时占用两列宽度。

## 5. 左侧栏交互

### 5.1 项目展开

- 允许多个项目同时展开。
- 点击项目整行会：
  1. 将项目设为当前项目；
  2. 恢复该项目最后使用的 Worktree/cwd；
  3. 切换该项目的展开或折叠状态。
- 项目运行或未读状态变化不会自动展开项目。
- 项目行选中背景表示当前项目；箭头只表示展开状态，两个概念互不混淆。
- 展开项目后继续使用现有 `buildSessionTree()` 呈现 fork 父子关系。

### 5.2 展开状态持久化

展开项目集合保存在：

```text
pi-web:expanded-projects
```

规则：

- 有有效持久化记录时恢复记录；
- 首次使用或记录损坏时，只展开当前项目；
- 读取或写入 `localStorage` 失败时静默回退，不阻止界面渲染。

### 5.3 项目活动状态

前端用现有 `allSessions`、`runningSessionIds` 和 `unreadSessionIds` 聚合：

```ts
isRunning = project.sessions.some(session => runningSessionIds.has(session.id));
isUnread = !isRunning && project.sessions.some(session => unreadSessionIds.has(session.id));
```

状态优先级为：

```text
运行中 > 未读 > 无状态
```

表现：

- 运行中：使用现有运行旋转动画或同语义的明显动态图标；
- 未读：使用现有未读圆点；
- 无状态：不占用强调色，可保留稳定对齐空间。

展开后，具体会话行仍显示自己的运行或未读状态。

后台会话从 running 变为 idle 且不是当前选中会话时，继续沿用现有逻辑标记未读。打开对应会话后清除该 session 的未读状态，项目聚合状态随之更新。

### 5.4 项目排序

- 有会话项目继续按最近会话 `modified` 倒序排列。
- 运行、停止或未读状态变化本身不改变排序。
- 手动打开但尚无会话的目录按最近打开时间参与排序。
- 当手动目录获得首个正式会话时，与会话项目按规范化项目根路径去重，不产生重复行。

### 5.5 项目行新建会话

- 每个项目行保留 `+`，移除顶部 `New`。
- 点击 `+` 必须 `stopPropagation()`，不切换该项目的折叠状态。
- 点击 `+` 会将该项目设为当前项目，使用该项目最后选择的 Worktree/cwd，并立即进入新会话界面。
- 若项目没有 Worktree 记录，则使用项目根路径。

## 6. 打开目录

顶部文件夹按钮复用现有目录选择与验证能力：

- 桌面壳环境调用 `window.piDesktop.selectDirectory()`；
- 浏览器环境显示路径输入浮层；
- 路径通过 `POST /api/cwd/validate` 验证；
- 现有默认目录入口可保留在路径输入浮层内，但不恢复项目下拉框。

验证成功后：

1. 将目录加入手动项目列表；
2. 将其设为当前项目和当前 cwd；
3. 自动展开该项目；
4. 右侧 Explorer 后续使用该目录；
5. 不自动创建会话。

手动目录保存在本地：

```text
pi-web:manual-projects
```

记录至少包含规范化路径和最近打开时间。损坏数据应被忽略。

## 7. 状态归属与数据流

### 7.1 `AppShell.tsx`

`AppShell` 成为工作区级状态中心，管理：

```ts
activeProjectRoot: string | null;
activeCwd: string | null;
projectCwds: Map<string, string>;
rightPanelMode: "closed" | "explorer" | "file";
```

职责：

- 接收侧边栏项目选择；
- 为每个项目记住本次页面生命周期中最后选择的 Worktree/cwd；
- 将当前项目和 cwd 提供给顶部 Worktree 控件及右侧 Explorer；
- 保持跨项目切换时关闭不属于当前项目的聊天这一现有语义；
- 在选择会话时，将该会话的 `cwd` 写入其项目的 Worktree 记录；
- 管理文件标签和右侧面板模式。

`projectCwds` 本次只做页面生命周期内记忆，不新增持久化键。

### 7.2 `SessionSidebar.tsx`

重构后只负责：

- 加载全部 sessions；
- 订阅全局 running SSE；
- 管理未读 session id；
- 合并会话项目和手动项目；
- 构建项目分组和 session fork 树；
- 管理项目展开集合；
- 处理打开目录、选择项目、选择会话、重命名和删除。

应从组件中移除：

- Worktree 请求、创建、删除和下拉状态；
- `FileExplorer` 引用、上传和刷新 UI；
- 旧项目选择下拉框及其过滤状态。

建议提取可单测的纯函数：

```ts
groupSessionsByProject();
getProjectActivity();
sortProjectGroups();
mergeManualProjects();
buildSessionTree();
```

### 7.3 running 数据流

服务端协议保持不变：

```text
AgentSessionWrapper 状态变化
  → notifyRunningChange()
  → /api/agent/running/events
  → { runningSessionIds }
  → SessionSidebar 客户端按 projectRoot 聚合
```

继续保留当前保障：

- `/api/sessions` 返回的 running 集合作为首屏兜底；
- SSE 首帧到达后成为权威来源；
- 慢 `/api/sessions` 响应不能覆盖 SSE 的更新；
- SSE 断线时保留最后已知集合，等待 EventSource 自动重连。

## 8. Worktree 控件

新增独立 `components/WorktreeSwitcher.tsx`，从 `SessionSidebar.tsx` 迁移现有功能：

- 获取 Worktree 列表；
- 切换 Worktree；
- 创建新 Worktree；
- 删除 Worktree；
- 脏 Worktree 的强制删除确认；
- 加载、禁用和错误状态。

建议接口：

```ts
interface WorktreeSwitcherProps {
  projectRoot: string | null;
  cwd: string | null;
  onCwdChange: (cwd: string, projectRoot: string) => void;
}
```

边界行为：

- Git 仓库根目录：控件正常启用；
- 非 Git 目录或 Git 子目录：控件显示禁用状态，并通过 tooltip 解释原因；
- 请求失败：保留当前 cwd，只在控件内显示错误；
- 删除当前 Worktree：回退到主仓库根目录；
- 切换项目：立即清除上一个项目遗留的下拉、错误和确认状态；
- 点击属于同项目其他 Worktree 的会话：顶部控件同步到该会话 cwd。

## 9. 右侧文件面板

建议新增 `components/WorkspaceFilePanel.tsx`，承载：

- `mode === "explorer"` 时的 `FileExplorer`；
- `mode === "file"` 时的 `TabBar + FileViewer`。

### 9.1 面板控制

- 点击 Explorer 按钮：`closed ↔ explorer`；
- 点击文件详情按钮：`closed ↔ file`；
- 打开其中一种模式时自动替换另一种模式；
- 没有当前目录时禁用 Explorer 按钮；
- 没有文件标签时禁用文件详情按钮；
- 点击 Explorer 中的文件：创建或激活文件标签，然后切换到 `file`；
- 关闭最后一个文件标签：若当前模式为 `file`，则切换到 `closed`。

### 9.2 Explorer 工具

文件 Explorer 的工具放在右侧面板标题栏：

- 上传；
- 刷新；
- 现有文件树；
- 现有 `@` 单文件和多文件引用能力。

Agent 完成任务后继续通过现有 `explorerRefreshKey` 刷新文件树。

### 9.3 响应式

- 桌面端复用现有右侧面板宽度动画和宽度规则；
- 移动端右侧面板占满可用内容区；
- 移动端打开右侧面板时关闭左侧抽屉；
- 移动端打开左侧抽屉时关闭右侧面板；
- 右上角两个固定按钮必须避免覆盖顶部 session stats，可相应增加右侧 padding。

## 10. 视觉与可访问性

- 项目路径保持紧凑截断，`title` 展示完整路径；
- 会话标题、时间、Worktree 分支标签继续保持现有截断逻辑；
- 项目行、`+`、展开按钮、Explorer 和文件详情按钮都提供明确的 `title`、`aria-label` 和禁用状态；
- 动画遵循现有颜色变量，并尊重 `prefers-reduced-motion`；
- 选中、hover、running 和 unread 不能只通过极其细微的颜色差异表达。

## 11. 错误和清理行为

- 删除会话后清理对应未读 id；
- 项目无会话且不是手动项目时从列表移除；
- `localStorage` 不可用时不报阻断错误；
- 打开目录验证失败时在输入浮层内展示错误，不添加项目；
- Worktree API 失败不改变当前有效 cwd；
- 文件浏览器加载失败只影响右侧 Explorer，不影响聊天或左侧项目列表；
- 右侧面板切换不销毁文件标签状态。

## 12. 测试计划

### 12.1 单元测试

为纯函数新增测试，覆盖：

1. sessions 按 `projectRoot ?? cwd` 分组；
2. 多个 Worktree 会话合并到同一个项目；
3. 任意 session running 时项目为 running；
4. running 状态优先于 unread；
5. 项目排序不受 running/unread 状态变化影响；
6. 手动项目与正式 session 项目去重；
7. 无会话手动项目按最近打开时间排序；
8. 展开项目持久化数据的正常读取和损坏数据回退；
9. session fork 树在项目分组后保持正确父子关系。

### 12.2 交互验收

1. 两个不同项目同时运行时，两个项目行独立显示运行状态；
2. 项目折叠时仍能看到运行状态；
3. 后台任务完成后，折叠项目变为未读圆点；
4. 打开对应会话后，会话和项目未读状态一起消失；
5. 多个项目展开后刷新页面，展开状态恢复；
6. running/unread 变化不会让项目跳位；
7. 项目行 `+` 使用该项目最后选择的 Worktree，并且不切换折叠状态；
8. Worktree 控件显示在 `Full history` 左侧，并随项目、会话和 cwd 同步；
9. Explorer 与文件详情互斥；
10. Explorer 点击文件后自动切换到文件详情；
11. 上传、刷新和 `@` 引用仍可使用；
12. 桌面和移动端不会出现左右面板互相遮挡。

### 12.3 验证命令

```bash
node_modules/.bin/tsc --noEmit
npm run lint
node --test <新增及相关测试文件>
```

遵循项目要求，不运行 `next build`。

## 13. 开发实例与用户验证

当前 PM2 中的生产实例为：

```text
name: pi-web
cwd: /Users/proxy
command: /opt/homebrew/bin/pi-web --hostname 0.0.0.0 --port 30141 --no-open
```

进入实现和人工验收阶段后，将该 PM2 应用替换为本仓库的开发实例，沿用应用名和端口：

```text
cwd: /Users/proxy/Documents/program/pi-web
command: npm run dev -- --hostname 0.0.0.0
port: 30141
```

要求：

- 先删除或停止旧 `pi-web` PM2 进程，避免端口冲突；
- 通过 PM2 启动开发命令，便于进程守护和用户持续访问；
- 启动后检查 PM2 状态、端口监听和 HTTP 可达性；
- 用户可在实现过程中直接刷新现有地址验证 HMR 变更；
- 不执行生产构建。

## 14. 预计文件变化

主要文件：

- `components/SessionSidebar.tsx`
- `components/AppShell.tsx`
- `components/WorktreeSwitcher.tsx`（新增）
- `components/WorkspaceFilePanel.tsx`（新增）
- `app/globals.css`

可能新增：

- 项目分组/持久化纯函数模块及其测试；
- Worktree 或右侧面板相关小型测试。

不计划修改：

- `app/api/agent/running/events/route.ts`
- `lib/rpc-manager.ts`
- session 文件格式。

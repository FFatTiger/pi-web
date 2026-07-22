# pi-web

[English](./README.md)

[pi 编程智能体](https://github.com/badlogic/pi-mono) 的本地网页界面。它会读取本机的 pi 会话文件，在浏览器里提供会话管理、实时对话、模型配置、技能管理和项目文件预览。

## 快速开始

**无需安装，直接运行：**

```bash
npx @agegr/pi-web@latest
```

**或全局安装后使用：**

```bash
npm install -g @agegr/pi-web
pi-web
```

启动后打开 [http://localhost:30141](http://localhost:30141)。命令行版本会在服务就绪后尝试自动打开浏览器。

**可选参数：**

```bash
pi-web --port 8080              # 自定义端口
pi-web --hostname 127.0.0.1     # 仅本机访问
pi-web -p 8080 -H 127.0.0.1     # 组合使用
pi-web --no-open                # 不自动打开浏览器

PORT=8080 pi-web                # 也支持环境变量
PI_WEB_NO_OPEN=1 pi-web         # 适用于后台服务或开机自启
```

## 功能介绍

- **把历史工作接回来**：打开网页就能按项目找到以前的 pi 对话，不必在终端里翻文件或记住会话路径。
- **放心试不同方向**：可以从某条历史消息重新开始，也可以复制出一条独立的新路线，探索方案时不怕弄乱原来的对话。
- **跨分支工作**：在侧边栏切换 Git worktree，让新会话和 Explorer 跟随你选择的 checkout。
- **边聊边看项目文件**：左侧浏览项目文件，右侧打开源码、文档、图片、音频和 PDF；文件变化会自动刷新，适合边让 agent 改边检查结果。
- **随时掌握会话状态**：在顶部就能看到上下文占用、花费、压缩结果和系统提示，长会话不再像黑箱。
- **少离开当前界面**：模型、登录/API key、模型测试和技能开关都能在网页里处理，配置 agent 时不用在多个工具之间来回切换。

## 注意事项

- **数据目录**：默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **会话文件**：路径形如 `~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **模型配置**：Models 面板读写 pi agent 目录下的 `models.json`，模型列表和默认模型由 pi 的配置解析得到。
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **Git worktree**：什么时候显示切换器、新建目录在哪里、删除会影响什么，见 [pi-web 里的 Worktree](./docs/worktrees.zh-CN.md)。
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件；“Edit from here” 是同一会话文件里的分支。

### 本地密码认证

当应用门禁开启时，pi-web 会要求先输入本地密码，才能使用界面与业务 API。这**不是**模型提供商的登录 / API key（`/api/auth/*` 下的 OAuth 与密钥管理）。应用门禁走 `/api/gate/*`（`/api/gate/status`、`/api/gate/login`、`/api/gate/logout`）。

配置文件路径：`$PI_CODING_AGENT_DIR/pi-web.json`（默认 `~/.pi/agent/pi-web.json`）。

```json
{
  "auth": {
    "password": "replace-with-a-strong-password",
    "disabled": false
  }
}
```

```bash
chmod 600 ~/.pi/agent/pi-web.json
PI_WEB_PASSWORD=replace-with-a-strong-password pi-web
PI_WEB_AUTH_DISABLED=true pi-web
```

- 环境变量会按字段覆盖文件配置（`PI_WEB_PASSWORD` 对应 `auth.password`，`PI_WEB_AUTH_DISABLED` 对应 `auth.disabled`）。
- 未配置、配置无效、或在未关闭门禁时没有可用密码时，应用会保持锁定状态。
- 只有**明确**关闭（文件中 `"disabled": true`，或 `PI_WEB_AUTH_DISABLED=true`）才会完全移除应用门禁。
- 修改配置文件或认证相关环境变量后，需要重启 pi-web 才会生效。
- 若要在局域网或公网暴露，请使用强密码、HTTPS，并配合防火墙或反代限制访问。不需要远程访问时建议仅绑定本机。

### PWA 与 Web Push

pi-web 可以安装为 Progressive Web App，并在 Agent 运行 settle 后可选发送系统通知。关闭浏览器或 PWA **不会**停止服务端已接受的 Agent：只要 pi-web 进程、宿主机与模型网络仍可用，任务会继续。前台仍是 HTTP + SSE；Web Push 仅在服务端 `agent_settled` 之后启动。

配置与应用门禁同文件：`$PI_CODING_AGENT_DIR/pi-web.json`（默认 `~/.pi/agent/pi-web.json`）。**没有** VAPID 环境变量——密钥由 pi-web 自动生成并存储。

```json
{
  "auth": { "password": "replace-me", "disabled": false },
  "push": { "disabled": false, "subject": "mailto:owner@example.com" }
}
```

```bash
PI_WEB_PUSH_DISABLED=true pi-web
PI_WEB_PUSH_SUBJECT=mailto:owner@example.com pi-web
```

- Push 优先级：环境变量（`PI_WEB_PUSH_DISABLED`、`PI_WEB_PUSH_SUBJECT`）覆盖 `pi-web.json` 中的 `push`；缺省 `push.disabled` 为开启（`false`）；缺省 subject 为 `https://github.com/agegr/pi-web`。subject 必须是 `mailto:` 或 `https:` URL。非法值只锁定 Push（安全 status 错误），不影响其余功能。
- Push 要求应用密码门禁处于 **enabled** 且用户已认证。门禁关闭时订阅接口会拒绝 Push。
- 浏览器需要安全上下文：**HTTPS**，或本地测试用 **localhost**。通知权限只能在明确的用户手势（设置/铃铛控件）后请求。iOS / iPadOS **16.4+** 必须先“添加到主屏幕”，再在已安装的 standalone PWA 中开启 Push。
- 页面可见且 running SSE 存活：settle 后 AppShell 显示站内 toast，约 **1500ms** 内 ACK 则抑制系统 Push。无 ACK（隐藏、冻结、关闭或 ACK 被阻）则发系统 Push。超时后的迟到 ACK 会被忽略；极少 toast+Push 重复可接受。
- 通知文案仅为通用文本（`Agent run finished` / `Agent run failed` / 测试文本），不含 prompt、回答、路径或工具输出。Abort 不通知；中途重试/压缩不通知；仅在最终 `agent_settled` 发一次。
- Service Worker 只缓存公开 PWA 资源（`/offline.html`、`/manifest.webmanifest`、图标）。不缓存 session、API、应用 HTML、Next chunk，也没有 Background Sync。离线导航只显示通用 fallback。
- 私有状态文件：`$PI_CODING_AGENT_DIR/pi-web-push.json`（默认 `~/.pi/agent/pi-web-push.json`），权限 **0600**。备份时当成密钥。文件损坏会锁定 Push（不会静默重生密钥）。密码变更会使旧订阅指纹失效；用新密码登录后会自动重绑当前浏览器订阅，无需再次弹权限。
- 反代：正确终止 HTTPS，**不要**缓冲 SSE，并保持 `/api/agent/*/events` 与 `/api/agent/running/events` 长连接。
- 更新：banner 提示用户确认刷新；禁止自动刷新，避免中途替换正在使用的页面。只有确认的标签页会刷新；其他标签页会提示已激活版本。

手动平台验收矩阵（非自动化）：[docs/pwa-web-push-acceptance.md](./docs/pwa-web-push-acceptance.md)。

## 开发

```bash
npm install
npm run dev
```

本地开发端口为 [http://localhost:30141](http://localhost:30141)。

常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

开发时不要运行 `next build` / `npm run build`，它会写入 `.next/`，容易影响正在运行的 dev server。发布流程再执行构建。

## 项目结构

```
app/
  api/
    agent/          # 创建/驱动 AgentSession，提供 SSE 事件流
    auth/           # OAuth 和 API key 管理
    cwd/validate/   # 自定义工作目录校验
    default-cwd/    # 获取 pi 默认工作目录
    files/          # 文件列表、读取、预览、watch
    home/           # 当前用户 home 目录
    models/         # 可用模型、默认模型、thinking levels
    models-config/  # 读写 models.json、测试模型
    push/           # status、VAPID public key、subscribe、presence、test
    sessions/       # 会话读取、重命名、删除、上下文、HTML 导出
    skills/         # skills 列表、搜索、安装、启停
  manifest.ts         # Web App Manifest
components/
  AppShell.tsx        # 主布局、URL 状态、顶部面板、文件标签、PWA/Push shell
  SessionSidebar.tsx  # 项目选择、会话树、Explorer
  ChatWindow.tsx      # 消息区、SSE、拖拽图片、minimap
  ChatInput.tsx       # 输入栏、模型/工具/thinking/compact/slash controls
  MessageView.tsx     # 消息、thinking、tool call/result 渲染
  ModelsConfig.tsx    # 模型和认证配置面板
  SkillsConfig.tsx    # 技能管理面板
  FileExplorer.tsx    # 文件树
  FileViewer.tsx      # 源码、diff、图片、音频、PDF、DOCX 预览
  AppToast.tsx / OfflineBanner.tsx / Pwa* / PushNotificationControl.tsx
lib/
  rpc-manager.ts      # AgentSessionWrapper 生命周期和全局 registry
  session-reader.ts   # 解析 .jsonl 会话文件和分支上下文
  normalize.ts        # 规范化 toolCall 字段名
  file-access.ts      # 文件读取安全边界（含 Push 秘密拒绝）
  file-paths.ts       # 文件路径编码/相对路径工具
  markdown.ts         # Markdown/Mermaid/KaTeX 插件配置
  pi-types.ts         # pi 相关类型
  push-*.ts / pwa-lifecycle.ts / settled-cycle.ts
hooks/
  useAgentSession.ts  # 会话加载、发送命令、SSE 状态机
  useAppPresence.ts   # 单一 running SSE + toast ACK
  usePwaInstall.ts / usePwaUpdate.ts / useWebPush.ts / useOnlineStatus.ts
  useAudio.ts         # 完成提示音
  useDragDrop.ts      # 图片拖拽
  useTheme.ts         # 主题切换
public/
  sw.js / offline.html / icons/
bin/
  pi-web.js           # npm CLI 入口
```

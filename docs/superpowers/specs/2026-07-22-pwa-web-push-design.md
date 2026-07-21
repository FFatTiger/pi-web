# PWA 与 Web Push 设计

日期：2026-07-22

## 1. 背景与目标

Pi Agent Web 是一个自托管的 Next.js Web 界面。浏览器负责发起操作、展示会话和接收实时事件，真正的 AgentSession 运行在 pi-web 的 Node/Next 服务进程中。

用户启动任务后，关闭浏览器标签页、退出已安装的 PWA 或移动设备暂时断网，不会自动终止已由服务端接受的 Agent 运行。只要 pi-web 服务进程、宿主机器和模型连接仍然可用，Agent 会继续工作。

本次采用“方案 B”：为 pi-web 增加可安装 PWA 和完整 Web Push 能力，使用户可以关闭浏览器或 PWA，等待服务端 Agent 完成后收到系统通知，再通过通知返回对应会话。

目标包括：

- 支持桌面 Chromium、Android 和 iOS/iPadOS 的 PWA 安装体验。
- PWA 在前台时完全保留现有 HTTP + SSE 实时通信，不改为 WebSocket，不让 Service Worker 拦截业务 API 或事件流。
- PWA 在后台、被冻结或关闭时，Agent 仍由服务端继续运行。
- Agent 真正完成后，由 pi-web 服务端发送标准 VAPID Web Push。
- 页面可见且站内事件实际可投递时，优先显示站内 toast，不重复发送系统 Push。
- 断网时提供安全、明确的离线提示，不把会话、代码、工具输出或认证页面缓存到浏览器持久存储。
- PWA 更新由用户确认应用，避免正在运行的页面被静默替换。

本次“完整 PWA”的定义是：安装、独立窗口、生命周期、离线感知、安全 fallback、更新提示和 Web Push 完整；不承诺断网运行 Agent 或离线浏览完整会话。

## 2. 已确认的运行模型

### 2.1 前台运行

PWA 安装后仍是标准浏览器页面。前台工作流保持现有架构：

```text
发送 prompt / abort / steer / follow-up
    → HTTP POST /api/agent/*

实时 Agent 事件
    → GET /api/agent/[id]/events（SSE）

全局运行状态和站内通知
    → GET /api/agent/running/events（SSE，扩展事件类型）
```

Service Worker 不拦截 `/api/*`，因此不会影响 SSE、Agent 命令、会话读取、文件读取、模型配置或鉴权。

### 2.2 后台或关闭页面

```text
浏览器发起任务
    → 服务端 AgentSession 开始运行
    → 浏览器进入后台、被冻结或关闭
    → SSE 可能断开，但 AgentSession 继续
    → Pi 发出 agent_settled
    → pi-web 服务端决定站内 toast 或 Web Push
```

以下情况才会影响 Agent 本身：

- pi-web 服务进程停止或重启。
- 宿主机器休眠、关机或失去网络。
- 模型 API、工具或 Agent 自身失败。
- 用户主动中止任务。

### 2.3 返回前台

PWA 返回前台时不假定旧 SSE 仍然有效。继续使用项目现有恢复路径：

- 重连会话 SSE。
- 查询 `/api/agent/[id]` 或对应状态接口。
- 对账 running、streaming、compaction 和 queued message 状态。
- 重读 session 文件，补回后台期间产生的消息。
- 重新上报页面可见性。

## 3. 范围与非目标

### 3.1 本次包含

- Web App Manifest。
- 192、512、Apple Touch 和真实 maskable 图标。
- Service Worker 注册与生命周期管理。
- Chromium 安装提示与 iOS 添加到主屏幕说明。
- 独立窗口与主题色元数据。
- 网络断开提示和公共离线 fallback 页面。
- PWA 更新检测、更新 banner、用户确认刷新。
- 标准 Push API + VAPID + `web-push` 服务端发送。
- Push subscription 的持久化、去重和失效清理。
- 页面可见性与 SSE 连接状态跟踪。
- 具备最终 assistant 结果的 settled cycle 完成或最终失败时，编排站内 toast / Web Push。
- 通知开关、订阅状态和测试通知入口。
- 密码变化后旧订阅失效。
- 桌面、Android 和 iOS 的验收说明。

### 3.2 本次不包含

- 离线运行 Agent。
- 离线发送 prompt、steer、follow-up 或 permission 决策。
- Background Sync 消息队列。
- 离线缓存 session 列表、聊天消息、工具输出或文件内容。
- 推送 prompt、回答正文、代码、路径或工具输出。
- Firebase Admin SDK、APNs 原生协议或原生移动应用。
- 多用户账号系统。
- 保证 Push 必达；Web Push 仍是浏览器和操作系统控制的尽力投递。

## 4. 方案选择

### 4.1 PWA 工具选择

不引入 Serwist、next-pwa 或完整 Workbox 构建集成。采用轻量、项目自有的 Service Worker：

- Manifest 固定由 `app/manifest.ts` 生成，页面 metadata 引用 `/manifest.webmanifest`。
- Service Worker 由 `public/sw.js` 提供。
- Service Worker 只处理公开 PWA 资源、离线 fallback、Push 和通知点击。
- Next 运行时 chunk、RSC 数据和动态 HTML 保持网络直连。

理由：

- pi-web 的核心数据是动态、受密码保护且可能敏感的会话内容。
- 本次不需要 Workbox 的大规模 precache 和 runtime API cache。
- 减少 Next 版本、webpack/turbopack 和插件兼容风险。
- Push 并不依赖完整离线 App Shell。

### 4.2 不照搬 Hapi 的部分

Hapi 的静态 Vite SPA 会预缓存构建产物，并短期缓存会话 API。pi-web 不复制这些行为，因为浏览器 Cache Storage 可能持久保存：

- 用户 prompt 和 Agent 回答。
- 本地文件路径和代码。
- 工具调用结果。
- 环境信息或意外出现的凭证。

Hapi 当前代码还存在登录后自动请求通知权限、文档声称 Background Sync 但未实现、没有完整 subscription change 恢复等问题。pi-web 只借鉴其成熟的服务端 Push 编排、可见页面抑制、VAPID 持久化和失效订阅清理。

## 5. PWA 客户端设计

### 5.1 Manifest 与图标

Manifest 至少声明：

- `name`: `Pi Agent Web`
- `short_name`: `Pi Web`
- `start_url`: `/`
- `scope`: `/`
- `display`: `standalone`
- `background_color`
- `theme_color`
- 192×192 普通图标
- 512×512 普通图标
- 512×512 maskable 图标

Maskable 图标必须在安全区域内重新排版，不能只给普通图标增加 `purpose: "maskable"` 声明。

Apple 侧提供 180×180 touch icon，并通过 Next metadata 声明 `appleWebApp`。

Next.js 16 的元数据位置固定如下，实施时不得混用：

- `app/layout.tsx` 的 `metadata` 声明 manifest、icons、applicationName 和 `appleWebApp`。
- 单独导出 `viewport: Viewport` 声明 `themeColor` 和 viewport/color-scheme 信息。
- `app/manifest.ts` 生成 `/manifest.webmanifest`。

### 5.2 安装体验

新增独立安装状态 hook 和轻量提示组件：

- Chromium：捕获 `beforeinstallprompt`，由用户点击“安装”后调用原生 prompt。
- iOS/iPadOS：检测 standalone 状态；未安装时显示“分享 → 添加到主屏幕”说明。
- 已安装时不显示安装提示。
- 用户关闭提示后写入 localStorage，避免每次进入都打扰。
- 提供设置入口重新显示安装说明。

Service Worker 在 `localhost` 开发环境也注册，以便直接验证安装和 Push。开发 worker 与生产使用相同的保守缓存边界：不缓存 Next chunk、动态 HTML、API 或 SSE，因此不得影响 HMR。若后续实现引入任何构建产物缓存，必须同时改为显式的 PWA 开发开关，不能默认污染 `npm run dev`。

安装提示不与通知权限绑定。用户可以只安装，不启用 Push。

### 5.3 离线行为

Service Worker 只预缓存公开且无敏感数据的资源：

- 离线 fallback HTML。
- Manifest。
- PWA 图标。

预缓存逐项执行；单个非关键图标或资源失败不能让整个 Service Worker 安装失败。

导航请求使用 network-first：

- 在线时直接访问 Next 页面和现有 gate。
- 网络请求真正失败时返回离线 fallback。
- 401、403、503 或登录重定向不视为离线，不回退到缓存页面。

Service Worker 明确不缓存：

- `/api/*`
- SSE
- `/login` HTML
- 受保护页面 HTML
- `/_next/static/*` 与 RSC 响应
- session、文件和模型数据

应用页面已打开后断网，顶部显示状态提示：Agent 和 API 需要网络，页面显示的是最后已知状态。新导航在离线时进入 fallback 页面。

公开 PWA 资源必须显式兼容现有应用 gate：

- `proxy.ts` matcher 精确排除 `/manifest.webmanifest`、`/sw.js`、`/offline.html` 和有边界的 `/icons/` 前缀。
- `lib/web-auth-request.ts` 的公开路径判断同步允许这些路径，避免代理和请求决策产生不一致。
- 相似但不相同的路径，例如 `/swXjs`、`/manifestXwebmanifest`、`/icons-private`，仍受 gate 保护。
- `/sw.js` 返回 `Cache-Control: no-cache, max-age=0, must-revalidate` 和 `Service-Worker-Allowed: /`。
- manifest 和带版本约束的图标可使用普通静态缓存；离线 fallback 使用可重新验证缓存。

这里的强制安全不变量仅针对 Service Worker Cache Storage：其中不得出现登录页、受保护 HTML、API、SSE、session、代码或工具输出。普通 HTTP 缓存继续遵循各路由现有语义；所有新增 Push API 明确使用 `Cache-Control: no-store`，本次不会泛化为重写所有既有业务 API 的缓存策略。

### 5.4 更新流程

Service Worker 不在安装时无条件 `skipWaiting()`。更新流程：

1. 首次安装时，如果页面尚无现有 controller，不显示“新版本可用”。
2. 已有 controller 的页面发现新 worker 进入 waiting 状态后，显示更新 banner。
3. 如果当前有 Agent 运行，banner 说明刷新不会停止服务端 Agent，但会重建前端连接；默认不自动刷新。
4. 用户点击刷新的当前标签页设置一个仅存在于该标签页内的 `reloadRequested` 标记，再向 waiting worker 发送 `SKIP_WAITING`。
5. worker 激活时调用 `clients.claim()`。
6. 所有受控标签页都可能收到 `controllerchange`；只有持有 `reloadRequested` 标记的标签页立即 reload。
7. 其他标签页不静默刷新，而是进入“新版本已激活，建议刷新”状态并继续显示更新提示。
8. 重新加载的页面通过现有 reconciliation 恢复会话状态。

页面可见时主动调用 `registration.update()`；另设低频更新检查，避免长时间运行的安装版一直使用旧 worker。多标签测试必须证明只有用户确认更新的标签页自动刷新。

## 6. Web Push 总体架构

```text
浏览器用户点击“启用通知”
    → Notification.requestPermission()
    → PushManager.subscribe(VAPID public key)
    → POST /api/push/subscribe

Pi AgentSession
    → 最终 agent_settled
    → PushNotifier 分类最终结果
    → PresenceRegistry 检查可见页面
       ├─ 可见 SSE toast 投递成功：结束
       └─ 无可见投递：PushService.send()
    → 浏览器厂商 Push Service
    → Service Worker push event
    → showNotification()
```

采用标准 Web Push，不配置 Firebase 项目，也不直接调用 APNs。Chrome、Firefox 和 Safari 使用各自浏览器 Push Service，服务端统一通过 VAPID 协议发送。

## 7. 正确的 Agent 通知时机

### 7.1 `agent_end` 不能代表最终完成

Pi SDK 中：

```text
agent_end
    → 可能自动重试
    → 可能自动 compaction
    → 可能继续 queued steer/follow-up
    → agent_settled
```

`agent_end` 还带有 `willRetry`，因此不能直接触发完成 Push。

### 7.2 使用 `agent_settled`

`lib/rpc-manager.ts` 中的 `AgentSessionWrapper` 是服务端唯一权威运行周期所有者。它新增 server-owned settled cycle：

1. wrapper 在没有 active cycle 时收到第一个 `agent_start`，分配单调递增的 `cycleId`。
2. 同一 cycle 内的自动重试、自动 compaction、steer、follow-up 和 queued continuation 继续使用同一个 `cycleId`。
3. 每次 `agent_end` 都更新 candidate result，后一次结果覆盖前一次；`willRetry` 的中间结果不触发通知。
4. 收到 `agent_settled` 时原子读取并消费当前 `{sessionId, cycleId, candidateResult}`，先清除 active cycle，再异步交给 PushNotifier。
5. 同一 `{sessionId, cycleId}` 只能消费一次；迟到或重复 settled 被忽略。
6. 下一次独立 `agent_start` 分配新的 cycleId。
7. 没有产生 `agent_start` 的 slash command、启动错误或普通 RPC 命令不创建通知 cycle。

该 cycle id 在服务端内存中生成，不依赖浏览器的 `promptRunIdRef`，因此页面关闭后仍可正确去重。

结果分类：

- 最后 assistant `stopReason` 为 `stop`、`length` 或其他非错误终态：完成通知。
- `stopReason === "error"`：失败通知。
- `stopReason === "aborted"`：默认不通知。
- 没有 assistant 消息、`prompt_error`/启动错误或仅执行不产生 Agent 运行的命令：只保留现有站内错误，不产生 Push。
- 自动重试中间的 `agent_end`：不通知。

第一版所谓“最终失败通知”只覆盖：settled cycle 的最终 candidate `agent_end.messages` 中，最后 assistant 明确为 `stopReason === "error"`。不承诺把所有服务端命令错误转换为 Push。

同一服务端 cycle 只允许产生一次最终通知，不能只依赖时间窗口。

### 7.3 通知内容

锁屏和站内通知共享唯一的版本化 payload：

```json
{
  "version": 1,
  "id": "server-notification-id",
  "sessionId": "session-id",
  "result": "success"
}
```

- `result` 只允许 `success` 或 `error`。
- Service Worker 和 AppShell 使用固定映射生成标题、正文和 tag。
- 两端都从 `sessionId` 自行构造 `/?session=${encodeURIComponent(sessionId)}`。
- 服务端 payload 不接受或携带任意标题、正文、tag 或 URL。

固定文案：

- 标题：`Pi Agent Web`
- success：`Agent run finished`
- error：`Agent run failed`

第一版不在系统通知中显示 prompt、回答、cwd、文件名或工具输出。点击后由登录态和现有 gate 决定是否能查看会话。

## 8. 页面可见性与站内 toast

### 8.1 单一全局 SSE 所有权

现有 `/api/agent/running/events` 的唯一客户端 owner 位于 `SessionSidebar.tsx`。实施时把该 EventSource 上提为一个 AppShell 级 hook/provider，并确保全应用只创建一个全局连接。该 owner 统一处理：

```text
connected    → connectionId
running      → runningSessionIds
notification → 站内 toast payload
```

它将 `runningSessionIds` 作为 props/context 交给 `SessionSidebar`，并驱动 AppShell 级 `AppToast`；不能在 `useAppPresence` 或其他组件再建立第二个全局 EventSource。per-session `/api/agent/[id]/events` 保持不变。

测试必须证明：

- AppShell 只创建一个 `/api/agent/running/events` EventSource。
- SessionSidebar 不再自行创建第二个连接。
- per-session SSE 的现有行为不变。

### 8.2 PresenceRegistry

新增服务端内存注册表，存放：

- 随机 `connectionId`
- 当前认证指纹
- visibility：`visible` 或 `hidden`
- lastSeen 时间
- 对应 SSE 发送函数
- 等待中的 notification ACK waiter

注册表放在 `globalThis`，与现有 RPC registry 一样跨 Next 热更新保持稳定。

连接终止时删除记录。为防止半开连接和移动端冻结，常量固定为：

- visible 页面每 15 秒上报 heartbeat。
- 服务端 35 秒未收到 heartbeat 即视为 stale。
- 每次 `visibilitychange` 立即上报。
- lazy prune 在 presence 更新和通知决策前执行，无需独立定时器。
- notification SSE 发出后等待最多 1500ms 的客户端 ACK。

服务端只有在 `visible` 且 `lastSeen` 未过期时，才把连接视为候选可见连接。仅 `controller.enqueue()` 或发送函数 resolve 不代表用户已看到 toast；必须收到对应 notification id 的 authenticated ACK 才抑制 Web Push。

页面 hidden、被冻结、关闭、heartbeat 过期、SSE 发送失败或 ACK 超时，都不抑制 Web Push。ACK 超时后发送 Push；迟到 ACK 可能造成罕见重复通知，这是优先避免漏报的已接受降级。

测试覆盖 ACK 成功、超时、断连、stale heartbeat 和迟到 ACK。

### 8.3 Presence API

新增：

```text
POST /api/push/presence
```

请求体：

```json
{
  "connectionId": "random-id",
  "visibility": "visible",
  "ackNotificationId": "optional-server-notification-id"
}
```

接口受现有 password gate 保护，只能修改属于当前认证指纹的连接。普通 heartbeat 不带 `ackNotificationId`；AppShell 实际接收、验证并展示 toast 后，再用同一接口 ACK 对应 notification id。

所有 Push mutating API（subscribe、unsubscribe、presence、test）统一要求：

- `Origin` 精确等于请求 origin。
- `Content-Type: application/json`。
- JSON 请求体上限 16 KiB；超出返回 `413 PUSH_BODY_TOO_LARGE`。
- JSON 解析失败、字段缺失或类型错误返回 `400 PUSH_INVALID_BODY`。
- 返回 `Cache-Control: no-store`。

### 8.4 前后台通知策略

```text
agent_settled
    → 有有效 visible SSE 候选？
       → 发送 versioned notification event
          → 1500ms 内收到至少一个 authenticated ACK：不发 Web Push
          → 没有 ACK：发送 Web Push
       → 没有候选：发送 Web Push
```

前台 PWA 的实时 SSE、输入、流式消息和 sidebar running badge 按现有方式工作。

## 9. VAPID 与订阅持久化

### 9.1 状态文件

Push 运行状态存放在：

```text
$PI_CODING_AGENT_DIR/pi-web-push.json
```

默认即：

```text
~/.pi/agent/pi-web-push.json
```

该文件由程序管理，不要求用户手动编辑，内容包括：

```json
{
  "version": 1,
  "vapid": {
    "publicKey": "...",
    "privateKey": "..."
  },
  "subscriptions": [
    {
      "endpoint": "https://push-service.example/...",
      "p256dh": "...",
      "auth": "...",
      "createdAt": "2026-07-22T00:00:00.000Z",
      "authFingerprint": "..."
    }
  ]
}
```

要求：

- 首次需要时自动生成 VAPID 密钥。
- 文件权限设置为 `0600`。
- 使用同目录临时文件 + rename 原子写入；临时文件命名固定以 `pi-web-push.json.tmp-` 开头。
- 同一进程内使用串行写入队列，避免并发覆盖。
- subscriptions 上限为 20；达到上限时 subscribe 返回 `409 PUSH_SUBSCRIPTION_LIMIT`，不自动删除仍有效设备。
- endpoint 全局唯一；新密码登录后的 authenticated upsert 必须替换同 endpoint 的旧 fingerprint 和 keys，不能保留跨密码 epoch 的重复记录。
- 读取损坏文件时锁定 Push 功能并记录服务端错误，不静默重新生成密钥覆盖现有状态。
- VAPID 私钥永不返回客户端或日志。

### 9.2 Push 配置与 VAPID subject

Web Push 默认在应用 gate 为 `enabled` 时可用，不要求用户预先生成密钥。支持以下可选配置：

```json
{
  "push": {
    "disabled": false,
    "subject": "mailto:owner@example.com"
  }
}
```

环境变量覆盖：

```text
PI_WEB_PUSH_DISABLED=true|false
PI_WEB_PUSH_SUBJECT=mailto:owner@example.com
```

优先级为环境变量、`pi-web.json`、安全默认值。`push.disabled` 缺省为 `false`。subject 必须是合法 `mailto:` 或 `https:` URI；默认值固定为项目地址：

```text
https://github.com/agegr/pi-web
```

非法 subject 或非法 disabled 值只锁定 Push 功能并在 status 中返回安全配置错误，不影响普通 pi-web 和应用 gate。

### 9.3 认证绑定

订阅接口要求现有应用 gate 状态为 `enabled` 且请求已认证。第一版在认证明确关闭时不启用 Web Push 订阅，避免任何能访问开放实例的人注册接收端点。

每个 subscription 保存当前有效密码的认证指纹。指纹定义为：使用 VAPID private key 作为 HMAC-SHA256 密钥，对固定用途标签 `pi-web-push-auth-v1`、NUL 分隔符和当前有效 gate password 计算摘要，再以 base64url 保存。实现必须复用单一 helper，不能在 API 和发送路径各自实现不同算法。

- 密码变化后旧 Cookie 失效。
- 旧 subscription 指纹不再匹配，发送时立即忽略；状态文件写入队列负责清理。
- 浏览器用新密码重新认证后，启动 reconciliation 可以用现有浏览器 subscription 对同 endpoint 做 authenticated upsert，绑定新 fingerprint，无需再次请求系统通知权限或要求用户重新点击启用。
- fingerprint 不返回客户端或日志。
- 读取 push 状态文件本身已等同于取得 endpoint、订阅密钥和 VAPID private key，因此文件权限、原子写入和日志脱敏是主要保护边界。

VAPID 密钥不随密码变化而旋转；只有订阅授权失效。

## 10. Push API 设计

新增受 gate 保护的接口：

```text
GET    /api/push/status
GET    /api/push/vapid-public-key
POST   /api/push/subscribe
DELETE /api/push/subscribe
POST   /api/push/presence
POST   /api/push/test
```

### 10.1 Status

返回当前浏览器 UI 需要的公开信息：

- Push 是否可用。
- 服务端是否配置成功。
- VAPID public key 是否存在。
- 当前 gate 是否允许订阅。
- 安全的错误代码，不包含私钥、文件内容或内部堆栈。

### 10.2 Subscribe

请求体使用标准 PushSubscription JSON 的必要字段：

```json
{
  "endpoint": "https://...",
  "keys": {
    "p256dh": "...",
    "auth": "..."
  }
}
```

校验：

- endpoint 必须为 HTTPS URL，UTF-8 编码后不超过 4096 字节。
- 禁止 URL username/password。
- 拒绝 IP literal、localhost 和明确私网主机。
- `p256dh` 必须是无 padding 的 87 字符 base64url，解码后必须是 65 字节、首字节为 `0x04` 的未压缩 P-256 公钥。
- `auth` 必须是无 padding 的 22 字符 base64url，解码后必须为 16 字节。
- endpoint、p256dh、auth 的格式或长度错误统一返回 `400 PUSH_INVALID_SUBSCRIPTION`。
- endpoint 全局唯一；authenticated upsert 更新 keys 和当前 auth fingerprint。
- 达到 20 个 subscription 时返回明确 409。
- 要求同源 `Origin`、JSON Content-Type 和有界请求体，降低 CSRF 与资源滥用风险。

Web Push 发送会访问浏览器提供的外部 endpoint。为防止订阅状态文件或 API 被利用进行 SSRF，发送路径必须把校验绑定到实际 socket：

- 固定采用 `web-push@3.6.7` 或兼容版本的 `options.agent` 能力，传入项目自有 `https.Agent`；不允许配置 `web-push` 的 proxy 选项，因为 proxy 会覆盖自定义 agent。
- Agent 提供自定义 `lookup(hostname, options, callback)`，该 lookup 正是 `https.request` 建立实际 socket 时调用的解析路径。
- lookup 使用系统 DNS 解析所有 A/AAAA 结果，拒绝空结果，也拒绝任何包含 loopback、link-local、RFC1918、CGNAT、ULA、IPv4-mapped IPv6 私网地址的结果集。
- 校验全部通过后，lookup 只把一个已校验的公有地址及其 family 返回给实际连接；HTTPS hostname、Host header 和 SNI 仍保持原 endpoint hostname，由 TLS 证书校验确认目标身份。
- `web-push` 不跟随 3xx；重定向响应按发送失败处理，不能对 Location 自动发起第二次请求。
- 每次发送前仍执行 URL 结构校验，但安全保证来自实际 socket 的 custom lookup，而不是独立的预解析。

测试必须通过注入 DNS resolver 覆盖纯公网、纯私网、混合公私、IPv4-mapped IPv6、空结果和解析错误，并证明传给 `web-push.sendNotification` 的是自定义 Agent，且未设置 proxy。

### 10.3 Unsubscribe

客户端传 endpoint。服务端只删除属于当前认证指纹的记录。

客户端执行顺序：

1. 获取当前 PushSubscription 和 endpoint。
2. 调用浏览器 `subscription.unsubscribe()`。
3. 无论本地 unsubscribe 是否成功，都尽力调用服务端 DELETE。
4. 服务端残留的无效订阅会在后续发送返回 404/410 时删除。

### 10.4 Test

测试接口只允许向当前认证指纹下已登记的 endpoint 发送固定测试 payload。客户端必须提交当前 endpoint，服务端不能接受任意目标 URL 或任意通知正文。

测试成功只证明 Push Service 接受请求，不保证设备最终展示；UI 应区分“已发送”和“已显示”。

## 11. PushService 与错误处理

服务端运行时依赖 `web-push`，初始化时调用 `setVapidDetails()`。

发送策略：

- 向当前有效认证指纹的所有 subscriptions 并行发送。
- 单个设备失败不阻塞其他设备。
- 404 或 410：删除失效 subscription。
- 401/403：记录 VAPID 或 endpoint 错误，不删除所有订阅。
- 429 或 5xx：记录临时失败；第一版不无限重试，避免完成事件阻塞 Agent 流程。
- 单次发送超时固定为 10 秒。
- Push TTL 固定为 5 分钟，过期完成通知不应在数小时或数天后展示。
- Push 发送在 `agent_settled` 后异步执行，失败不得让 Agent 请求或 SSE handler 报错。

订阅变更恢复：

- 每次已认证应用启动时，如果 Notification permission 已授权，检查当前 `pushManager.getSubscription()` 并重新同步服务端。
- 如果订阅已消失，创建新订阅并登记。
- 支持 `pushsubscriptionchange` 的浏览器可作为增强，但第一版不能只依赖该事件。

## 12. Service Worker Push 行为

Service Worker 增加：

```text
push
notificationclick
message（更新流程）
```

### 12.1 Push

- 解析固定的 version 1 payload：`{version,id,sessionId,result}`。
- 拒绝未知版本、缺少 id/sessionId 或未知 result；不能接受服务端任意标题、正文、tag 或 URL。
- 使用本地固定映射生成 Pi Web 标题、正文、icon、badge 和 tag。
- 从 `sessionId` 自行构造站内相对链接。
- 未提供或无法解析 payload 时忽略，不能抛出未捕获异常。
- 不把 payload 写入 Cache Storage。

### 12.2 Notification click

1. 关闭通知。
2. 读取并校验 version 1 payload；未知 payload 回到 `/`。
3. 从已校验的 `sessionId` 构造 `/?session=<encoded-id>`，不读取 payload 中的任意 URL。
4. 查找同 origin 的现有 window client。
5. 有现有窗口时 navigate 到目标会话并 focus。
6. 没有窗口时 `clients.openWindow()`。
7. 如果 gate Cookie 已失效，现有 proxy 会跳转登录页并保留安全 next。

## 13. 客户端通知设置

新增 `hooks/useWebPush.ts` 作为客户端 Push 的单一状态 hook，暴露：

- supported
- permission
- subscribed
- busy
- error
- enable
- disable
- sendTest

通知权限只能由明确的用户点击触发：

```text
用户点击铃铛
    → Notification.requestPermission()
    → granted 后 PushManager.subscribe()
    → POST subscription
```

不能在登录、页面 mount、Agent 完成或定时器回调中首次请求权限。

UI 状态：

- 不支持：禁用或隐藏，并提供解释。
- 未授权：灰色铃铛，“启用完成通知”。
- 已授权但未订阅：显示重试。
- 已订阅：实心铃铛，可测试、可关闭。
- 权限被拒绝：说明需在浏览器/系统设置中恢复。
- iOS 未 standalone：说明先添加到主屏幕，再从 PWA 中启用。

Web Push 上线后，不再额外从 per-session SSE 无条件创建本地 Notification，避免隐藏页面同时收到本地通知和 Web Push。前台使用站内 toast；后台统一由 Web Push 负责。

## 14. 安全与隐私边界

- Manifest、图标、Service Worker 和离线 fallback 可在 gate 外公开；它们不包含业务数据。
- Push API、presence API 和 test API 全部受 gate 保护。
- `lib/file-access.ts` 增加优先于 allowed-root 判断的硬拒绝：精确的 `$PI_CODING_AGENT_DIR/pi-web-push.json` 以及同目录所有 `pi-web-push.json.tmp-*` 临时文件，在目录列表和直接文件读取中都隐藏/拒绝，即使 session cwd 是 `$HOME`、`$PI_CODING_AGENT_DIR` 或它们的父目录。
- Push 状态文件不能通过 `/api/files`、FileExplorer、文件链接授权或其他允许根规则读取。
- 日志不记录 endpoint 全文、p256dh、auth 或 VAPID private key；如需诊断只记录 endpoint host 和短摘要。
- 锁屏 payload 使用通用文案，不含 prompt、回答、代码、cwd 或工具结果。
- 密码改变后旧订阅停止发送。
- Service Worker 不缓存认证页面和业务响应。
- Push endpoint 在登记和发送前都执行目标校验，避免状态文件被手工篡改后成为任意出站请求来源。

## 15. 模块与预计文件边界

预计新增：

```text
app/manifest.ts
app/api/push/status/route.ts
app/api/push/vapid-public-key/route.ts
app/api/push/subscribe/route.ts
app/api/push/presence/route.ts
app/api/push/test/route.ts
components/PwaInstallPrompt.tsx
components/PwaUpdateBanner.tsx
components/PushNotificationControl.tsx
components/AppToast.tsx
hooks/usePwaInstall.ts
hooks/usePwaUpdate.ts
hooks/useWebPush.ts
hooks/useAppPresence.ts
lib/push-config.ts
lib/push-store.ts
lib/push-target.ts
lib/push-service.ts
lib/push-presence.ts
lib/push-notifier.ts
public/sw.js
public/offline.html
public/icons/*
```

预计修改：

```text
app/layout.tsx
components/AppShell.tsx
components/SessionSidebar.tsx
components/ChatInput.tsx
lib/file-access.ts
lib/rpc-manager.ts
lib/pi-types.ts
next.config.ts
proxy.ts
package.json
package-lock.json
bun.lock
README.md
README.zh-CN.md
AGENTS.md
```

package.json 中 `web-push` 必须放在 runtime `dependencies`；如果当前版本需要外部 TypeScript declarations，则放入 `devDependencies`。更新 `package-lock.json` 和 `bun.lock`，保持仓库双 lockfile 同步。

测试文件按现有 `.test.mjs` 习惯放在对应模块附近。实际计划可在保持模块职责的前提下合并少量过小文件。

## 16. 实施阶段

### Phase 1：安装与安全 PWA 基础

- Manifest 和正确图标。
- Service Worker 注册。
- 安装提示。
- 离线 fallback 和在线状态提示。
- 更新 waiting 状态与用户确认刷新。
- Gate matcher、请求决策 helper 和缓存头。
- `lib/file-access.ts` 对 Push 状态文件和临时文件的硬拒绝。

验收：

- Desktop Chrome/Edge 可安装。
- Android Chromium 可安装。
- iOS/iPadOS 可添加到主屏幕并以 standalone 打开。
- 前台 SSE、发送、Abort、Steer 不受影响。
- Service Worker 在 localhost 开发环境也能注册并验证安装/Push，同时不影响 Next HMR。
- 断网新导航显示 fallback。
- Cache Storage 不含会话、API 或 Next 页面内容。
- 即使 session cwd 为 `$HOME` 或 `$PI_CODING_AGENT_DIR`，FileExplorer 和 `/api/files` 也看不到 Push 状态文件或临时文件。
- 首次安装不误显示更新 banner；多标签中只有确认更新的标签页自动刷新。

### Phase 2：Web Push 通路

- `web-push` 依赖。
- VAPID 自动生成与安全存储。
- Push store、实际连接目标校验和订阅 API。
- 订阅全局 endpoint upsert、上限和密码重新绑定。
- 客户端启用/关闭/测试控制。
- SW `push` 和 `notificationclick`。

验收：

- 已安装 PWA 或支持 Push 的浏览器可订阅。
- 页面关闭后可收到固定 test push。
- 点击通知打开 pi-web。
- 404/410 自动删除订阅。
- 密码变化后旧订阅立即不可接收；用新密码重新登录后，同一浏览器 endpoint 可自动安全重绑，无需再次弹系统权限。
- test push TTL 和 timeout 生效。
- `npm pack --dry-run` 显示发布包包含 `public/sw.js`、offline HTML、manifest 生成所需代码和全部图标。

### Phase 3：Agent 完成编排

- `agent_end` 最终结果捕获。
- `agent_settled` 唯一最终触发。
- 全局 SSE owner 上提到 AppShell 级，SessionSidebar 只消费 running ids。
- 全局 SSE connectionId、versioned notification event 和客户端 ACK。
- PresenceRegistry、15 秒 heartbeat、35 秒 stale expiry、1500ms ACK timeout。
- 站内 toast / Web Push 二选一。
- 成功、失败、中止分类和 run id 去重。

验收：

- 自动重试中途不通知。
- 自动 compaction 中途不通知。
- queued continuation 结束前不通知。
- 最终 settled 只通知一次。
- 用户主动中止默认不通知。
- 可见页面实际展示并 ACK toast 时不收到 Push。
- visible 连接没有 ACK、页面 hidden、冻结、关闭或 SSE 失败时收到 Push。
- 同一应用实例只有一个全局 running-events EventSource。
- 通知点击打开正确 session。

### Phase 4：文档和跨平台加固

- PWA 和 Push 使用说明。
- HTTPS、localhost、iOS 16.4+ 限制。
- 反向代理 SSE/Push 注意事项。
- VAPID 状态文件备份与故障恢复。
- 浏览器权限恢复说明。
- 安装、更新和 Push 的手工验收矩阵。

## 17. 测试策略

### 17.1 PWA 静态与生命周期

- Manifest 字段、Next metadata/Viewport 边界、图标尺寸和 maskable 声明。
- SW 不缓存 `/api`、登录页、Next chunk 或 session 数据。
- 离线只在网络失败时 fallback。
- waiting worker 只有用户确认后激活。
- 首次安装不显示更新提示。
- 多标签 controllerchange 只自动刷新持有 tab-local `reloadRequested` 的页面。
- notification click 从受控 sessionId 构造同 origin URL，不接受 payload 任意 URL。
- 公开 PWA 路径可绕过 gate，近似路径仍受保护。
- `/sw.js` 的 no-cache 和 scope header 正确。

### 17.2 Push store 与安全

- 首次生成 VAPID，后续稳定复用。
- 文件权限和原子写入。
- 损坏文件锁定而非覆盖。
- subscription endpoint 全局 upsert、unsubscribe 和 auth fingerprint 过滤。
- 密码变化清理旧授权，新密码 authenticated reconciliation 重绑同 endpoint。
- 20 个 subscription 上限和明确 409。
- endpoint、实际 socket DNS 目标和 base64url 校验。
- P-256 65 字节与 auth 16 字节解码校验。
- IPv4-mapped IPv6、私网、loopback、link-local、ULA 和混合公私结果集被拒绝。
- 并发写入不会丢记录。
- `$HOME`、agent dir 和父目录作为 allowed root 时，push state/临时文件仍无法列表或读取。

### 17.3 Push service

- 正常发送到所有有效设备。
- 单设备失败不阻塞其他设备。
- 404/410 删除。
- 429/5xx 保留并记录。
- 10 秒 timeout 和 5 分钟 TTL 传给实际发送请求。
- 发送异常不影响 Agent 流程。
- versioned payload 不含任意文案、URL 或敏感字段。

### 17.4 Presence 与通知编排

- AppShell 只创建一个 global running-events SSE，SessionSidebar 不再创建第二个。
- per-session SSE 行为保持不变。
- visible + 新鲜 heartbeat + SSE notification + 1500ms 内 authenticated ACK 时只 toast。
- hidden、过期、断连、投递失败或 ACK 超时时 Push。
- 迟到 ACK 允许罕见重复，但不能导致漏 Push。
- 服务端 cycle id 在首个 agent_start 分配，同 cycle 多次 agent_end 覆盖 candidate。
- `agent_end(willRetry=true)` 不通知。
- `agent_settled` 原子消费一次并清除 cycle。
- 连续两个独立 run 使用不同 cycle id。
- 最终 error assistant 发失败通知。
- `prompt_error` 且没有 settled assistant result 不通知。
- aborted 不通知。
- 多 session 独立去重。

### 17.5 API 与 gate

- 未登录访问 Push API 被拒绝。
- gate disabled 时订阅被明确拒绝并返回安全状态。
- 所有 mutating Push API 都执行精确 Origin、JSON Content-Type 和 body size 校验。
- 公开 PWA 静态资源不会产生登录循环。
- 相似伪路径不会意外公开。
- 新增 API 返回 `Cache-Control: no-store`。
- 业务 API 仍保持受保护。

### 17.6 项目验证

实施过程中运行：

```bash
node --test <相关测试文件>
node_modules/.bin/tsc --noEmit
npx eslint <本次修改源码文件>
```

最终运行完整现有 Node 测试集，并执行 `npm pack --dry-run` 检查发布文件。开发阶段不运行 `next build`，遵守项目约束。

浏览器手工验收至少覆盖：

- Desktop Chrome 或 Edge。
- Android Chrome/Edge。
- iOS/iPadOS 16.4+ 已安装 Home Screen PWA。
- 普通前台 SSE。
- PWA 后台、关闭、重新进入。
- Push 权限允许、拒绝、撤回。
- 密码变更。
- 新 Service Worker 更新。

## 18. 故障与降级

- 浏览器不支持 Push：PWA、SSE 和 Agent 功能仍正常，仅不提供后台系统通知。
- 用户拒绝通知权限：不重复自动提示，UI 提供恢复说明。
- Push state 配置损坏：Push 功能显示错误，普通 pi-web 保持可用。
- 浏览器 Push Service 不可达：记录失败，Agent 完成不受影响。
- 页面 presence 上报失败：没有 ACK 时发送 Push，避免漏报；可能出现少量重复通知，优先保证后台提醒。
- Web Push 不可用地区：第一版不增加 Telegram 等替代渠道，可在后续作为独立 notification channel 扩展。
- pi-web 服务进程停止或宿主机器休眠：无法发送 Push；PWA 本身不能替代持续运行的服务端。

## 19. 完成标准

满足以下条件才视为方案 B 完成：

- PWA 可在目标桌面和移动平台安装并独立打开。
- PWA 前台的现有 HTTP + SSE 行为不受破坏。
- 浏览器或 PWA 关闭后，服务端 Agent 继续运行。
- Agent `agent_settled` 且存在可分类的最终 assistant result 后，后台设备能够收到真实 Web Push。
- 自动重试、compaction 和 queued continuation 中途不产生错误完成通知。
- 页面可见且实际 ACK 站内 toast 时不重复系统 Push；未 ACK 时按超时 fallback 到 Push。
- Push 点击能安全打开正确会话，登录失效时进入 gate 并保留安全 next。
- 通知权限只由明确用户操作申请。
- 密码改变使旧 Push 授权失效。
- 浏览器 Cache Storage 中没有 session、代码、工具输出、认证 HTML 或 API 响应，且 Push 状态私钥文件无法通过文件浏览接口读取。
- 更新流程由用户确认，不静默替换正在使用的页面。
- Push 故障不会影响 Agent、SSE、会话、文件、模型、技能、插件或工作树功能。
- 自动测试、类型检查和修改文件 lint 通过，并完成浏览器平台手工验收。

# Chat Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

聊天功能域 — 聊天列表、消息时间线、Turn 输入、消息发送、事件同步、已读标记、Outbox 刷新。

## Module Map

- `features/chats/` — 聊天列表面板
- `features/turns/` — 消息时间线、Turn 输入（含语音）
- `features/realtime/` — 聊天实时同步（Socket.IO 连接、缓存、URL 解析）
- `runtime/data-sync/flows/chat-flow.ts` — 聊天数据流

## Kernel References

### UI Shell (D-SHELL-019, D-SHELL-022, D-SHELL-023, D-SHELL-024, D-SHELL-025)

`chat` 是 desktop baseline anchor 之一。root shell、list row、shared action 与 overlay family 的 baseline design 收敛由 `D-SHELL-019` 与 `D-SHELL-022` 定义。

Chat 内部左侧栏属于 governed sidebar family：

- `chat-list` 必须登记到 `renderer-design-sidebars.yaml`。
- search + entity-row list 必须通过 shared sidebar primitive 表达。

### DataSync (D-DSYNC-003)

聊天数据流（方法清单见 `D-DSYNC-003`）。

Desktop core chat surface 仅展示 human chat；Agent chat 不得出现在 ChatList / MessageTimeline 等 core product 组件中。

### State (D-STATE-004)

- `selectedChatId`：当前选中的聊天 ID。
- `activeTab = 'chat'` 时渲染 ChatList + MessageTimeline + TurnInput。

### Hook (D-HOOK-004)

Chat 可用 UI 扩展槽位以 `spec/desktop/kernel/tables/ui-slots.yaml` 为准；本域只引用 `D-HOOK-004`，不再内联枚举 slot 名。

### Turn Hook (D-HOOK-003)

Turn 生命周期拦截：`pre-policy` → `pre-model` → `post-state` → `pre-commit`。

### LLM (D-LLM-002)

Desktop core chat surface 的 turn 执行只承载 human chat 所需的通用 `ExecuteLocalTurnInput`。
Agent chat route 不属于 core chat contract；mods 必须通过 host-only capability `data-api.core.agent.chat.route.resolve` 自行解析。

### Streaming (D-STRM-001, D-STRM-002, D-STRM-003, D-STRM-004)

Turn 流式执行通过 `D-STRM-001` 定义的订阅生命周期消费 Runtime 流式输出。消息气泡增量渲染（`D-STRM-002`），流中断保留已渲染内容（`D-STRM-003`），用户可主动停止生成（`D-STRM-004`）。

### Network (D-NET-006)

`features/realtime/` 通过 Socket.IO 建立实时连接，提供聊天事件即时同步。`resolve-realtime-url.ts` 解析连接地址，`chat-realtime-cache.ts` 管理本地事件缓存，`use-chat-realtime-sync.ts` 封装 React hook 生命周期。

### Bootstrap (D-BOOT-003)

聊天数据在 `loadInitialData()` 中加载（`D-DSYNC-003`）。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`（Check 1, 4~5, 11, 13~14, 16~17, 21, 23 相关规则）。

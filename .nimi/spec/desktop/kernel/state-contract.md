# State Contract

> Authority: Desktop Kernel

## Scope

Desktop 状态管理契约。定义 Zustand store 的 slice 架构、运行时字段映射、持久化策略。

本契约只拥有 store 结构、字段映射与持久化 mechanics。Agent Chat orchestration、
message/action semantics、voice workflow、media execution、prompt/context assembly、
and Runtime Agent execution truth are Runtime-owned. State surface 只能承载
Desktop UI state、SDK / Runtime projection cache、或 visible lifecycle projection，
不得成为平行 Agent Chat 语义 owner。

## D-STATE-001 — Auth Slice

`createAuthSlice` 管理认证状态：

- `auth.status: AuthStatus`（`'bootstrapping' | 'anonymous' | 'authenticated'`）
- `auth.user: Record<string, unknown> | null`
- `auth.token: string`

操作：`setAuthBootstrapping`、`setAuthSession`、`clearAuthSession`。

## D-STATE-002 — Runtime Slice

`createRuntimeSlice` 管理运行时执行字段：

- `runtimeFields: RuntimeFieldMap`（Runtime/SDK route projection 与可透传的 non-authority execution context 字段）
- `runtimeDefaults: RuntimeDefaults | null`

初始 `RuntimeFieldMap`：
- `targetType: ''`
- `mode: 'STORY'`
- `turnIndex: 1`
- `localProviderEndpoint: ''`

`RuntimeFieldMap` 必须保持 string-keyed extensible map 语义；Desktop 可以预置核心字段，但不得将额外 runtime field key 视为非法。Desktop core 不得预置 Agent chat launcher 语义。

`runtimeFields` 的 route-related 字段在 `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）下只允许作为 execution projection / transient input；不得继续承担 selection truth、projection truth 或 thread-global route owner 语义。
这些 route-related 字段不得从 `runtime_defaults`、renderer env fallback、或 Desktop-owned provider/model defaults 派生。

若 Desktop 持久化 Agent Chat UI settings，仅允许表达 local UI preference / placement
intent。`runtimeFields`、slice-local derived state、thread metadata 或 UI 临时字段都不得拥有
Runtime Agent Chat behavior、turn planning、message/action、voice workflow、or
execution policy truth，也不得在 hydration / migration 时猜默认值。

若 Desktop 为 runtime-owned deferred continuation / `HookIntent` 建立 anchor-bound pending
indicator、为 modality action 建立执行投影或历史记录，这些字段也只能承载 admitted resolved
outputs 的 projection / lifecycle evidence。store、hydration、migration、timer recovery、或
UI state 不得决定 deferred continuation / `HookIntent` 是否存在、是否继续有效、是否应被
delivery、或 `promptPayload` 应是什么；缺失合法 resolved message/action outputs 或
runtime-owned hook outputs 时必须 fail-close。

当前 admitted pending continuation state 只允许 process-local projection ownership；
持久化 store 不得在 hydration 后自动恢复旧 pending continuation timer，也不得把
thread/anchor metadata 升格成递归 continuation chain 的 owner。

## D-STATE-004 — UI Slice

`createUiSlice` 管理 UI 导航状态：

- `activeTab: AppTab`、`previousTab: AppTab | null`
- `selectedChatId`、`selectedProfileId`、`selectedProfileIsSource`
- `profileDetailOverlayOpen`：共享资料详情弹层占据主内容区时为 `true`，shell 左 rail 需要隐藏
- `statusBanner: StatusBanner | null`
- `bootstrapReady: boolean`、`bootstrapError: string | null`

导航操作：`setActiveTab`、`navigateToProfile`、`navigateToWorld`、`navigateBack`。

## D-STATE-005 — Store 组合

所有 slices 通过 `create<AppStoreState>` 合并为单一 Zustand store `useAppStore`。

- 不使用 middleware（无 devtools、persist）— Tauri webview 环境下 Zustand middleware 与 HMR 热替换存在兼容性问题；持久化通过 admitted Tauri backend IPC（`D-IPC-001`）或 owner-specific Runtime/Realm projections 实现，无需 Zustand persist middleware。
- HMR 连续性只能保存 process-local UI/projection cache，不得保存 token custody、Realm business truth、Runtime execution truth、或恢复已退休的 DataSync hot-state。

## Fact Sources

- `agent-chat-projection-contract.md` — D-LLM-022 ~ D-LLM-026 Desktop Agent Chat projection boundary
- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md` — Runtime Agent Chat execution/projection authority
- `tables/store-slices.yaml` — Slice 枚举
- `tables/app-tabs.yaml` — AppTab 枚举

# State Contract

> Authority: Desktop Kernel

## Scope

Desktop 状态管理契约。定义 Zustand store 的 slice 架构、运行时字段映射、持久化策略。

本契约只拥有 store 结构、字段映射与持久化 mechanics；Agent chat 的
single-message、turn-mode、experience-policy / settings 语义继续由
`agent-chat-behavior-contract.md`（`D-LLM-022` ~ `D-LLM-026`）拥有；delayed beat、
pending beat invalidation、modality action envelope、以及 model-generated
modality prompt semantics 继续由 `agent-chat-message-action-contract.md`
（`D-LLM-027` ~ `D-LLM-033`）拥有。State surface 只能承载这些语义的存储或
lifecycle projection，不得成为平行语义 owner。

## D-STATE-001 — Auth Slice

`createAuthSlice` 管理认证状态：

- `auth.status: AuthStatus`（`'bootstrapping' | 'anonymous' | 'authenticated'`）
- `auth.user: Record<string, unknown> | null`
- `auth.token: string`

操作：`setAuthBootstrapping`、`setAuthSession`、`clearAuthSession`。

## D-STATE-002 — Runtime Slice

`createRuntimeSlice` 管理运行时执行字段：

- `runtimeFields: RuntimeFieldMap`（provider、model 与可透传的 runtime execution context 字段）
- `runtimeDefaults: RuntimeDefaults | null`
- `localManifestSummaries`、`registeredRuntimeModIds`、`runtimeModDisabledIds`
- `runtimeModUninstalledIds`、`runtimeModSettingsById`、`runtimeModFailures`
- `runtimeModHydrationById`（或等价 Desktop mod host projection）：按 `modId + generation/source revision`
  表达 `not_requested` / `scheduled` / `hydrating` / `hydrated` / `failed`
- `fusedRuntimeMods`（熔断记录）

`localManifestSummaries` 的来源固定为 runtime mods 安装目录；Desktop 不扫描源码仓作为发现输入。
`localManifestSummaries` 只表示 manifest/source/diagnostic projection；不得被解释为 entry 已 import 或
`setup()` 已执行。`registeredRuntimeModIds` 只允许表示 Desktop host 中已完成 setup 的 active mod registrations；
若实现需要展示未 hydration 的 mod，必须通过 hydration projection 或 manifest projection 表达，不得伪造
registered 状态。

初始 `RuntimeFieldMap`：
- `targetType: ''`
- `mode: 'STORY'`
- `turnIndex: 1`
- `localProviderEndpoint: ''`

`RuntimeFieldMap` 必须保持 string-keyed extensible map 语义；Desktop 可以预置核心字段，但不得将额外 runtime field key 视为非法。Desktop core 不得预置 Agent chat launcher 语义；Agent chat 相关字段仅允许作为 mod-owned runtime context 透传。

`runtimeFields` 的 route-related 字段在 `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）下只允许作为 execution projection / transient input；不得继续承担 selection truth、projection truth 或 thread-global route owner 语义。

若 Desktop 持久化 Agent chat settings，仅允许持久化
`agent-chat-behavior-contract.md`（`D-LLM-023`）定义的
`AgentChatExperienceSettings` product-facing preference truth。`runtimeFields`、
slice-local derived state、thread metadata 或 UI 临时字段都不得拥有
`ResolvedExperiencePolicy`、`resolvedTurnMode` 的 canonical
语义，也不得在 hydration / migration 时替这些 resolved outputs 猜默认值。

若 Desktop 为 runtime-owned deferred continuation / `HookIntent` 建立 anchor-bound pending
indicator、为 modality action 建立执行投影或历史记录，这些字段也只能承载 admitted resolved
outputs 的 projection / lifecycle evidence。store、hydration、migration、timer recovery、或
UI state 不得决定 deferred continuation / `HookIntent` 是否存在、是否继续有效、是否应被
delivery、或 `promptPayload` 应是什么；缺失合法 resolved message/action outputs 或
runtime-owned hook outputs 时必须 fail-close。

当前 admitted pending continuation state 只允许 process-local projection ownership；
持久化 store 不得在 hydration 后自动恢复旧 pending continuation timer，也不得把
thread/anchor metadata 升格成递归 continuation chain 的 owner。

## D-STATE-003 — Mod Workspace Slice

`createModWorkspaceSlice` 管理 mod 工作区：

- `modWorkspaceTabs: ModWorkspaceTab[]`（`tabId: 'mod:${modId}'`、`title`、`fused`）
- 操作：`openModWorkspaceTab`、`closeModWorkspaceTab`
- `modWorkspaceTabs` 中存在的条目即表示 Desktop host 视为“已打开”的 mod route runtime instance

`tabId` 是当前 Desktop route runtime identity。任何公开的 route lifecycle 或 route retention 语义都必须以 `tabId` 为作用域，而不是 `modId`。

Desktop host 对 mod workspace tab 的产品规则固定为：

- 同时最多允许 `5` 个已打开的 mod workspace tabs
- 当第 `6` 个不同的 mod tab 打开请求到达时，host 必须拒绝该请求，不得隐式关闭、替换或卸载已有 tab
- 若目标 `tabId` 已经处于已打开集合中，host 必须激活已有 tab，而不是将该请求视为超限失败
- 只要 mod tab 仍处于已打开集合中，普通 tab 切换不得导致 host 自动卸载对应 route instance
- route instance 的销毁仅允许由用户关闭 tab、mod 被禁用/卸载、或 host 明确执行销毁触发

## D-STATE-004 — UI Slice

`createUiSlice` 管理 UI 导航状态：

- `activeTab: AppTab`、`previousTab: AppTab | null`
- `selectedChatId`、`selectedProfileId`、`selectedProfileIsAgent`、`selectedWorldId`
- `profileDetailOverlayOpen`：共享资料详情弹层占据主内容区时为 `true`，shell 左 rail 需要隐藏
- `statusBanner: StatusBanner | null`
- `bootstrapReady: boolean`、`bootstrapError: string | null`

导航操作：`setActiveTab`、`navigateToProfile`、`navigateToWorld`、`navigateBack`。

## D-STATE-005 — Store 组合

所有 slices 通过 `create<AppStoreState>` 合并为单一 Zustand store `useAppStore`。

- 不使用 middleware（无 devtools、persist）— Tauri webview 环境下 Zustand middleware 与 HMR 热替换存在兼容性问题；持久化通过 Tauri backend IPC（`D-IPC-001`）和 DataSync 热状态（`D-DSYNC-000`）实现，无需 Zustand persist middleware。
- 热状态通过 `globalThis` 键保持 HMR 连续性（参考 `D-DSYNC-000`）。

## Fact Sources

- `agent-chat-behavior-contract.md` — D-LLM-022 ~ D-LLM-026 behavior authority boundary
- `agent-chat-message-action-contract.md` — D-LLM-027 ~ D-LLM-033 message/action authority boundary
- `tables/store-slices.yaml` — Slice 枚举
- `tables/app-tabs.yaml` — AppTab 枚举

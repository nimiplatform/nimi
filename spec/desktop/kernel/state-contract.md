# State Contract

> Authority: Desktop Kernel

## Scope

Desktop 状态管理契约。定义 Zustand store 的 slice 架构、运行时字段映射、持久化策略。

## D-STATE-001 — Auth Slice

`createAuthSlice` 管理认证状态：

- `auth.status: AuthStatus`（`'bootstrapping' | 'anonymous' | 'authenticated'`）
- `auth.user: Record<string, unknown> | null`
- `auth.token: string`

操作：`setAuthBootstrapping`、`setAuthSession`、`clearAuthSession`。

## D-STATE-002 — Runtime Slice

`createRuntimeSlice` 管理运行时执行字段：

- `runtimeFields: RuntimeFieldMap`（provider、model、agent、world 等绑定参数）
- `runtimeDefaults: RuntimeDefaults | null`
- `localManifestSummaries`、`registeredRuntimeModIds`、`runtimeModDisabledIds`
- `runtimeModUninstalledIds`、`runtimeModSettingsById`、`runtimeModFailures`
- `fusedRuntimeMods`（熔断记录）

`localManifestSummaries` 的来源固定为 runtime mods 安装目录；Desktop 不扫描源码仓作为发现输入。

初始 `RuntimeFieldMap`：
- `targetType: 'AGENT'`
- `mode: 'STORY'`
- `turnIndex: 1`
- `localProviderEndpoint: 'http://127.0.0.1:1234/v1'`

`RuntimeFieldMap` 必须保持 string-keyed extensible map 语义；Desktop 可以预置核心字段，但不得将额外 runtime field key 视为非法。

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

- `tables/store-slices.yaml` — Slice 枚举
- `tables/app-tabs.yaml` — AppTab 枚举

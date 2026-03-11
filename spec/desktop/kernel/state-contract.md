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

## D-STATE-003 — Mod Workspace Slice

`createModWorkspaceSlice` 管理 mod 工作区：

- `modWorkspaceTabs: ModWorkspaceTab[]`（`tabId: 'mod:${modId}'`、`title`、`fused`）
- 操作：`openModWorkspaceTab`、`closeModWorkspaceTab`

## D-STATE-004 — UI Slice

`createUiSlice` 管理 UI 导航状态：

- `activeTab: AppTab`、`previousTab: AppTab | null`
- `selectedChatId`、`selectedProfileId`、`selectedWorldId`
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

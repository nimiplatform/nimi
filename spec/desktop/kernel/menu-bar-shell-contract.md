# Menu Bar Shell Contract

> Authority: Desktop Kernel

## Scope

macOS Desktop 顶栏入口（menu bar / status item）契约。定义 menu bar 作为 Desktop shell 的常驻入口时的状态投影、菜单动作、窗口生命周期与退出语义。

## D-MBAR-001 — Menu Bar Presence

Desktop 在 macOS 环境下必须支持 menu bar 常驻入口。

- menu bar 是 Desktop shell 的一部分，不是独立 runtime 进程。
- Phase 1 保留 Dock 图标与主窗口，不切换到 `ActivationPolicy::Accessory`。
- `enableMenuBarShell` feature flag 为 shell 是否启用 menu bar 入口的唯一门控。

## D-MBAR-002 — Status Projection

menu bar 状态数据固定来自两层：

1. **平台管理层**：daemon lifecycle 状态通过 `D-IPC-002` 的 `runtime_bridge_status` / `start` / `stop` / `restart` 投影。
2. **应用健康层**：runtime/provider 细粒度健康通过现有 SDK runtime health APIs 投影，不新增 Tauri backend 平行 gRPC/HTTP health 路径。

menu bar 聚合状态至少包含：

- window visible / hidden
- daemon status
- runtime health summary
- provider summary
- in-flight daemon action
- lastUpdatedAt / lastError

如果 renderer 健康摘要超过 15s 未刷新，menu bar 必须回退到 daemon lifecycle 级别显示，不得继续显示陈旧的 provider/runtime health 细节。

## D-MBAR-003 — Menu Structure

Phase 1 menu bar 菜单固定包含以下区块：

1. **状态头**：`running / degraded / starting / stopped / unavailable`
2. **快捷入口**：`Open Nimi`、`Open Runtime Dashboard`、`Open Local Models`、`Open Cloud Connectors`、`Open Settings`
3. **状态摘要**：runtime health、provider summary、gRPC、PID、managed/external、last check
4. **操作区**：`Start Runtime`、`Restart Runtime`、`Stop Runtime`、`Refresh Status`
5. **退出区**：`Quit Nimi`

`Restart Runtime` 与 `Stop Runtime` 在 `managed=false` 时必须禁用，Desktop 不得通过 menu bar 停止或重启外部 runtime。

## D-MBAR-004 — Navigation Dispatch

menu bar 的页面跳转必须遵循：

- backend 负责 `show/focus` 主窗口
- backend 通过 app event 向 renderer 发出导航事件
- renderer 负责更新 `activeTab` 与 runtime-config `activePage`

Phase 1 的 app event 固定为 `menu-bar://open-tab`，payload 仅允许：

- `{ tab: 'runtime', page?: 'overview' | 'local' | 'cloud' | 'catalog' | 'runtime' | 'mods' }`
- `{ tab: 'settings' }`

menu bar 不得直接耦合具体 React 组件实例。

## D-MBAR-005 — Close-To-Hide And Quit

在启用 menu bar shell 的 macOS Desktop 中：

- 主窗口 `CloseRequested` 必须被拦截并转为 `hide window`
- `Open Nimi` 必须恢复并聚焦主窗口
- 只有显式 `Quit Nimi`、系统级 Quit 或等效 quit path 才允许触发 app 退出

Quit path 必须执行：

1. 停止前端轮询 / auth watcher 等 shell cleanup
2. 若 daemon `managed=true` 且正在运行，则执行 `runtime_bridge_stop`
3. 退出应用进程

## Fact Sources

- `bootstrap-contract.md` — 退出路径与 daemon 生命周期
- `bridge-ipc-contract.md` — daemon lifecycle / health sync IPC
- `ui-shell-contract.md` — shell feature flag 与入口语义
- `tables/feature-flags.yaml` — menu bar shell flag
- `tables/ipc-commands.yaml` — menu bar IPC commands

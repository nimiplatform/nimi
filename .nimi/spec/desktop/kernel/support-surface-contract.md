# Support Surface Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop `Support` 表面的产品语义。`Support` 是一个独立的 secondary 系统
表面，承载 repair、updates、diagnostics、logs/export、recovery help 五个子区。

`Support` 不是 ordinary primary navigation tab。普通用户 primary navigation 固定
为 `Home | Chat | Characters | Explore | Apps | Runtime`（`D-SHELL-001`）。
`Support` 与 `Settings` 一样属于 Secondary/System 分组：可由菜单、账户区或
Settings 入口打开，但不得作为额外的 primary nav 项。

`Support` 是一个**独立 surface**（与 Settings 平级），不是 Settings 内的一组
section。manual 将 `Support` 与 `Settings` 列为平级 §-级标题，acceptance
scenario 14 也将二者列为各自独立的非 primary 类别。独立 surface 也保证 repair /
recovery 在 Settings preference 状态本身损坏时仍可达。

不拥有：

- self-update / release 真值与更新执行机制（`self-update-contract.md`
  `D-IPC-014` / `D-IPC-015`，`P-SUPD-*`）；Support 只投影并触发其受管 command。
- `~/.nimi` config 迁移与修复执行（`P-MIG-*`）；Support repair 子区只调用
  `P-MIG-*` 修复流程，不重定义它。
- Runtime diagnostic / log / audit 真值（Runtime kernel）；Support 只消费其
  typed projection。
- product-control first-run 状态机（`P-COLD-*`）。

## D-SUP-001 — Support As Secondary System Surface

`MUST`：`Support` 必须注册为 `app-tabs.yaml` 中 `nav_group: secondary` 的
表面，与 `settings` 平级。它必须可从菜单 / 账户区 / Settings 入口到达。

`MUST NOT`：`Support` 不得进入 `getCoreNavItems()` 的 core 导航；ordinary
primary navigation 必须保持恰好 5 项。`Support`、其子区（repair / updates /
diagnostics / logs / recovery）均不得作为 primary ordinary 产品类别。

## D-SUP-002 — Support Sub-Area Set

`MUST`：`Support` 表面必须承载且仅承载以下五个子区，对应 manual §Support：

1. `repair` — 配置 / 数据根 / 依赖修复入口。
2. `updates` — Desktop 应用更新与 independently installed Runtime service
   compatibility / repair 状态投影。
3. `diagnostics` — 技术诊断聚合视图。
4. `logs` — 日志查看与导出。
5. `recovery` — 恢复帮助 / 引导。

`MUST NOT`：`Support` 不得承载 ordinary preference 设置（account / language /
appearance / notifications 等）——这些归 `Settings`。`Support` 不得成为
developer surface 的入口——developer surface 归 `D-DEV-*`。

## D-SUP-003 — Repair Sub-Area

`MUST`：`repair` 子区必须将修复动作委托给 `P-MIG-*` 的修复流程与 `P-COLD-*`
的 product-control 修复状态。它必须能够呈现并触发：

- `~/.nimi` governed config 文件的 `repair_required` / `blocked` 修复
  （`P-MIG-004`）。
- broken-pointer 修复（`P-MIG-004` / `P-MIG-005`），且永不孤立既有数据。
- `nimi_data` data-root 修复 / 迁移入口（`P-MIG-007`）。

`MUST NOT`：`repair` 子区不得自行实现 schema 迁移、pointer 重建或数据搬运
逻辑；不得在无 impact preview 的前提下执行任何会删除或孤立用户数据的修复
（`P-MIG-005` / `P-MIG-008`）。

## D-SUP-004 — Updates Sub-Area

`MUST`：`updates` 子区是 `self-update-contract.md` "更新器可用性投影" 假定的
Application Update 宿主表面。它必须消费 `DesktopReleaseInfo` 投影并展示当前
desktop release、target desktop release 与 updater state；当前 verified Runtime
service release、mutual compatibility 与 repair state 必须来自 protected-local
service status 投影，不能来自 Desktop manifest。Desktop update 动作通过受管
Tauri update command（`desktop_update_*`）触发，Runtime service update/repair
保持独立的 signed service-updater authority。

`MUST`：当 `updaterAvailable=false` 时，静默检查必须 no-op；手动更新动作必须
直接展示 `updaterUnavailableReason`，不得调用已知会失败的 updater command。

`MUST NOT`：`updates` 子区不得在 renderer 侧合成默认 version 信息、不得由
fallback version info 掩盖 release metadata、Runtime trust/compatibility 或
service repair 错误；不得展示 bundled/staged Runtime path，因为该产品路径不
存在。

## D-SUP-005 — Diagnostics Sub-Area

`MUST`：`diagnostics` 子区必须将分散的 feature-local 诊断聚合为一个统一的
technical diagnostics 视图，消费 Runtime / SDK 暴露的 typed diagnostic
projection（daemon lifecycle、host capability profile、dependency job state、
selected source record projection）。

`MUST NOT`：`diagnostics` 子区不得拥有 Runtime diagnostic / log / audit 真值，
不得绕过 typed projection 直接读取 runtime 内部状态，不得把 ordinary-user
正常使用路径建立在诊断视图之上。

## D-SUP-006 — Logs And Export Sub-Area

`MUST`：`logs` 子区必须提供日志查看与日志导出。它消费 `tables/log-areas.yaml`
定义的日志区与 `nimi_data` data-root 下的 `logs/` 目录（`P-MIG-006`
`logs` 行：owner `runtime_product_support`，可导出供 support 使用）。

`MUST`：日志导出必须产出一个用户可定位的导出工件；导出失败时必须 fail-closed
呈现 typed 失败，不得静默产出空文件或伪成功工件。

`MUST NOT`：`logs` 子区不得篡改或删除 `logs/` 目录内容来"清理"——日志保留与
清理遵守 `P-MIG-006` 的 `logs` 行 cleanup rule（retention policy）。

## D-SUP-007 — Recovery Help Sub-Area

`MUST`：`recovery` 子区必须提供恢复帮助：在 `~/.nimi` 损坏、`nimi_data`
缺失 / 不可达、或 first-run 未完成等 fail-closed 场景下，向用户呈现指向 repair
子区与 first-run / setup 状态的恢复引导。

`MUST`：recovery 引导必须使用 `P-COLD-001` 的 typed fail-closed 状态语义与
`first-run-state-machine.yaml` 的 copy floor，不得展示技术 enum 名作为主要
用户文案。

`MUST NOT`：`recovery` 子区不得自行声称已恢复 readiness——readiness 真值仍由
product-control record（`P-COLD-015` / `P-COLD-016`）admission 决定。

## D-SUP-008 — Support Reachability Under Degraded State

`MUST`：`Support` 表面（至少 repair 与 recovery 子区）必须在 Settings
preference 状态本身损坏、或 ordinary shell 因 fail-closed 状态不可进入时仍然
可达。Support 的可达性不得依赖 ordinary shell readiness。

`MUST NOT`：`Support` 不得只在 `ready_for_use` 之后才可达；它必须是 fail-closed
状态下用户的一等恢复入口。

## Fact Sources

- `.nimi/spec/desktop/kernel/ui-shell-contract.md` — `D-SHELL-001`, `D-SHELL-002`
- `.nimi/spec/desktop/kernel/self-update-contract.md` — `D-IPC-014`, `D-IPC-015`, §更新器可用性投影
- `.nimi/spec/desktop/kernel/devtools-contract.md` — `D-DEV-001..D-DEV-007`
- `.nimi/spec/desktop/kernel/tables/app-tabs.yaml`
- `.nimi/spec/desktop/kernel/tables/log-areas.yaml`
- `.nimi/spec/platform/kernel/local-config-migration-contract.md` — `P-MIG-001..P-MIG-008`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001`, `P-COLD-009..P-COLD-016`
- `.nimi/spec/platform/kernel/tables/first-run-state-machine.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-data-directory-ownership.yaml`

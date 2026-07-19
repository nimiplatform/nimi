# DevTools And Developer Mode Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop `Developer Tools` 表面与 `Developer Mode` 门控的产品语义：
Developer Mode 的可发现切换入口、DevTools 表面的门控、developer diagnostics
的可见性默认值。

`Developer Tools` 是一个 developer/internal 表面，不是 ordinary primary
navigation tab。它只在 admitted Developer Mode 开启时可达。

本契约取代并收口 `D-SHELL-009` 中关于 Developer Mode 入口的笼统描述：
`D-SHELL-009` 仍保留为 `ui-shell` 的导航锚点，本契约（`D-DEV-*`）
拥有 Developer Mode 门控与 DevTools 表面的完整规则集。

## D-DEV-001 — Developer Tools As Gated Developer Surface

`MUST`：`Developer Tools` 必须注册为 `app-tabs.yaml` 中
`nav_group: developer` 的表面，并由 feature flag `enableDeveloperTools` 门控。
它只在 admitted Developer Mode 开启时可达。

`MUST NOT`：`Developer Tools` 不得进入 ordinary primary navigation；它不得
出现在 ordinary-user Nimi Home close evidence；ordinary primary navigation
必须保持恰好 5 项：`Home`、`Chat`、`Explore`、`Apps`、`Runtime`。

## D-DEV-002 — Discoverable Developer Mode Toggle

`MUST`：Developer Mode 的开启、关闭与当前状态展示必须位于 App 内一个可发现
位置——canonical 位置为 `Settings`。Developer Mode 不得仅能通过启动参数、
环境变量或隐藏快捷键进入。

`MUST`：Developer Mode 默认为关闭。只有用户在可发现入口显式开启后，
`Developer Tools` 表面与 developer-only surface 才变为可达。

`MUST NOT`：第三方开发者使用 Desktop 时，不得被要求通过启动参数
或环境变量进入主要开发路径。

## D-DEV-003 — DevTools Surface Composition

`MUST`：`Developer Tools` 表面在 Developer Mode 下承载：

- 开发态技术诊断入口（technical diagnostics）。

`MUST`：先前孤立、未接入任何可达路由的 Developer 页面（`DeveloperPage`）必须
被接入此表面，且仅在 Developer Mode 下可达。它不得保持为无入口的 orphan
surface，也不得在 Developer Mode 关闭时可达。

`MUST NOT`：`Developer Tools` 不得承载 ordinary-user 产品功能；ordinary
product path 不得依赖 `Developer Tools` 的存在或可达性。

## D-DEV-004 — One Production Developer Mode And Dev Trust Set

`MUST`：Desktop 只提供一个 production `Developer Mode` 与一个 `Dev Trust
Set`。已登录 production account 可以使用；mode 默认关闭，开启本身不授予任何
Nimi API permission，也不创建 principal、grant、lease 或 session。

`MUST NOT`：不得提供 test-only service principal、dev daemon、environment
toggle、hidden mode、direct `go run ... serve`、renderer auth、localhost trust
或第二套 developer account/session truth。

## D-DEV-005 — Local Development Lifetimes And Invalidation

`MUST`：项目 decision lifetime 只有 `run_once` 与 `allow_project`。
`allow_project` 是 Runtime-owned 持久项目 consent；run 结束、Desktop 重启、
Runtime restart/upgrade/reinstall、mode off 与 account 暂时离开不得要求重复
presence，也不得自动启动。每次显式 dev launch、edit/build/process replacement
和 Runtime boot epoch 变化都必须按 Runtime 规则产生新 lease/session，旧
process/session 不得继承。revoke、project/account/permission/shell/entry/risk
binding 变化必须重新批准或立即 deny。

`MUST`：Desktop 必须把 zero-permission session 与独立的 product permission
posture 分开呈现；不得把 project admitted、process running 或 session open
显示成 permission approved。当前权限目录全部 reserved 时，不得渲染伪造的
approve/revoke 管理中心。

## D-DEV-006 — Native Execution Risk And Failure UX

`MUST`：确认面必须明确告知本地项目将在 Windows 原生进程中执行、可访问其
OS user 权限范围内的资源，而 Nimi API 仍受独立 permission/owner policy 限制。首次
批准及 disclosure revision 变化后必须重新确认。

`MUST`：UI 必须有可判定的 loading、disabled、retry、no-grant、grant-approved、
Runtime-unavailable、account-switched、revoked、build-failed、process-replaced
与 Runtime-restarted 状态；长 project/error/capability 文本和窄屏不得溢出或
隐藏主要动作。

`MUST NOT`：不得用 fail-closed shell、toast-only failure、console message、
隐式 retry 或假成功替代真实状态与恢复动作。

## D-DEV-007 — Developer Surface Visibility Default

`MUST`：所有 developer / internal surface（`Developer Tools`、
developer diagnostics）的默认可见性为不可见 / 不可达。
它们只在 admitted Developer Mode 显式开启后变为可达。

`MUST NOT`：任何 developer / internal surface 不得在默认安装态对 ordinary
用户可见或可达；不得通过 default-true feature flag 把 developer surface
默认暴露给 ordinary 用户。

## Fact Sources

- `.nimi/spec/desktop/kernel/ui-shell-contract.md` — `D-SHELL-001`, `D-SHELL-002`, `D-SHELL-009`
- `.nimi/spec/desktop/kernel/support-surface-contract.md` — `D-SUP-001..D-SUP-008`
- `.nimi/spec/desktop/kernel/tables/app-tabs.yaml`
- `.nimi/spec/desktop/kernel/tables/feature-flags.yaml`

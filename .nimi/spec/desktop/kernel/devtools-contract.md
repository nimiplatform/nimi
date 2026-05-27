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
- `.nimi/topics/ongoing/2026-05-20-nimi-product-manual-authority-recovery/product-manual-full-authority.md` — §Support / Settings / Developer Tools (1469-1495)

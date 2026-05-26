# DevTools And Developer Mode Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop `Developer Tools` 表面与 `Developer Mode` 门控的产品语义：
Developer Mode 的可发现切换入口、DevTools 表面的门控、embedded Tester 的门控、
`nimi.tester` 在 App admission registry 的登记关系、以及 developer surface
的可见性默认值。

`Developer Tools` 是一个 developer/internal 表面，不是 ordinary primary
navigation tab。它只在 admitted Developer Mode 开启时可达。

本契约取代并收口 `D-SHELL-009` 中关于 Developer Mode 入口的笼统描述：
`D-SHELL-009` 仍保留为 `ui-shell` 的导航锚点，本契约（`D-DEV-*`）
拥有 Developer Mode 门控与 DevTools 表面的完整规则集。

### Tester Extraction Boundary（明确边界）

本契约**只**规定两件与 Tester 相关的事：(a) 把 Desktop-embedded Tester
门控在 Developer Mode 之后；(b) 确认 `nimi.tester` 在 App admission registry
的登记关系。

本契约**不**要求、也**不得**被解读为要求在本 portfolio 内把 Tester 源码完整
抽取为独立 standalone app。完整抽取受 `nimi-app-admission-contract.md`
`P-NAPP-016` 的 "frozen source until stability evidence" 规则约束，并由
portfolio T4（App 机制）拥有。Desktop-embedded Tester 在 `nimi.tester`
stability evidence 出现之前，只能作为 frozen internal source/validation
surface，不得被删除。

不拥有：

- `nimi.tester` 的 App admission 真值与 registry row（`P-NAPP-016`、
  `nimi-app-registry.yaml`、`nimi-app-release-descriptors.yaml`）。
- World Tour Tester 产品语义（`world-tour-tester-contract.md` `D-LLM-066..104`）。

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
- developer-only surface，仅在其 admission 允许的范围内。

`MUST`：先前孤立、未接入任何可达路由的 Developer 页面（`DeveloperPage`）必须
被接入此表面，且仅在 Developer Mode 下可达。它不得保持为无入口的 orphan
surface，也不得在 Developer Mode 关闭时可达。

`MUST NOT`：`Developer Tools` 不得承载 ordinary-user 产品功能；ordinary
product path 不得依赖 `Developer Tools` 的存在或可达性。

## D-DEV-005 — Embedded Tester Gated Behind Developer Mode

`MUST`：Desktop-embedded Tester（`features/tester/**`）只能在 admitted
Developer Mode 下可达。它必须保持为 frozen internal source / validation
surface。

`MUST NOT`：Desktop-embedded Tester 不得作为 ordinary primary navigation
entry，不得出现在 ordinary-visible Apps projection，不得作为 ordinary-user
可见产品表面。它不得在 Developer Mode 关闭时可达。

`MUST NOT`：本契约不得被用于在本 portfolio 内删除 Desktop-embedded Tester。
hard-cut retirement 必须等待 `nimi.tester` stability evidence（`P-NAPP-016`）。

## D-DEV-006 — `nimi.tester` Registry Registration Relationship

`MUST`：`Developer Tools` 表面对 `nimi.tester` 的引用必须消费 Platform App
admission registry 中已 admitted 的 `nimi.tester` row（`P-NAPP-016`：
`admission_status: admitted`、`ordinary_visibility: developer-only`、
`package_kind: nimi-app`、`release_descriptor_ref:
nimi.tester.bundled-with-nimi`）。`nimi.tester` 作为 developer-only Nimi App
出现在 developer-visible 范围内。

`MUST NOT`：`Developer Tools` 不得以 Desktop-embedded Tester、workspace
fixture cache、Tauri command name、source folder、GitHub repo 或 npm package
作为 `nimi.tester` 的 App admission / install 真值。registry row 是唯一
admission 真值源。

`MUST NOT`：本契约不得 mandate 在本 portfolio 内把 Tester 源码完整抽取为
standalone app；该抽取由 T4 拥有并受 `P-NAPP-016` 的 stability-evidence
precondition 约束。

## D-DEV-007 — Developer Surface Visibility Default

`MUST`：所有 developer / internal surface（`Developer Tools`、
embedded Tester、developer diagnostics）的默认可见性为不可见 / 不可达。
它们只在 admitted Developer Mode 显式开启后变为可达。

`MUST NOT`：任何 developer / internal surface 不得在默认安装态对 ordinary
用户可见或可达；不得通过 default-true feature flag 把 developer surface
默认暴露给 ordinary 用户。

## Fact Sources

- `.nimi/spec/desktop/kernel/ui-shell-contract.md` — `D-SHELL-001`, `D-SHELL-002`, `D-SHELL-009`
- `.nimi/spec/desktop/kernel/world-tour-tester-contract.md` — `D-LLM-066..D-LLM-104`
- `.nimi/spec/desktop/kernel/support-surface-contract.md` — `D-SUP-001..D-SUP-008`
- `.nimi/spec/desktop/kernel/tables/app-tabs.yaml`
- `.nimi/spec/desktop/kernel/tables/feature-flags.yaml`
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-016`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/topics/ongoing/2026-05-20-nimi-product-manual-authority-recovery/product-manual-full-authority.md` — §Support / Settings / Developer Tools (1469-1495)

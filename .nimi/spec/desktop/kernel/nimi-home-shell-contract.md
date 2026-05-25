# Nimi Home Shell Contract

> Owner Domain: `D-HOME-*`

## Scope

定义 desktop host 渲染 `Nimi Home`（Platform `P-HOME-*`）的 hosted shell IA、
first-run state machine、return-run state machine、surface registry 投影、
Agent Chat in-shell 引用 placement、`AIScopeRef` 强制规则、与 no-private-path
强制规则。

本契约只拥有 desktop-hosted shell 实现层；Platform `P-HOME-*` 拥有产品
ontology 与 non-owner 边界。两者必须在每条规则上互相不重叠。

## D-HOME-001 — Hosted Shell Ownership

`MUST`：desktop host 拥有 `Nimi Home` hosted shell IA、navigation、surface
placement、windowing、与 first-run / return-run state machine 的实现。

`MUST NOT`：desktop host 不得在 hosted shell 之上自定义产品 ontology；
ontology 由 Platform `P-HOME-001..P-HOME-010` 拥有。

## D-HOME-002 — First-Run State Machine

`MUST`：first-run state machine 必须消费 `P-AIPS-010` 的 factory
AIProfile 状态（`ai-profile-pending` / `ai-profile-accepted` /
`ai-profile-materializing` / `ai-profile-active` / `ai-profile-failed`）
以及 `P-COLD-*` 的 fail-closed cold-start 状态。

`MUST NOT`：first-run 不得在 `active` evidence 缺失时投影 `ready`、
`available`、或 generic `done`；不得直接跳过 alias 接受步骤；不得在
Runtime materializer confirmation 之前启动本地 dependency download /
install / repair。

## D-HOME-003 — Return-Run State Machine

`MUST`：return-run state machine 在没有重新触发 first-run 的情况下，仍
必须显式处理 Runtime health、account state、app status、settings、与
developer-mode toggles 的状态变迁。

`MUST NOT`：return-run 不得跳过 cold-start fail-closed 投影；任何 upstream
authority 缺失仍按 `P-COLD-001` 状态投影。

## D-HOME-004 — Apps Surface Placement

`MUST`：Apps surface placement 是 Desktop primary navigation 的 ordinary
入口之一。Apps 行的数据 source 由 Nimi App registry / package projection、
SDK Nimi App client projection、与 Runtime registration projection 提供；本
契约只锁定 placement 与非 owner 边界。

`MUST NOT`：Apps 不得拥有 app admission truth、marketplace truth、或
package trust truth；不得读取 app-local spec、workspace source tree、或未
admitted registry row 作为可见性来源；不得显示 Avatar。

## D-HOME-005 — Apps Card State Placement

`MUST`：Apps 必须以显式 typed projection 区分
`not_installed_installable`、`installing`、`installed_ready`、
`update_available`、`update_required`、`permission_required`、
`repair_required`、`unsupported_on_this_device`、`blocked_by_policy`、
`install_failed`、`uninstalling` 等状态。

`MUST NOT`：Apps 不得自创 app registry truth；不得把 distinct
fail-closed 状态压缩为单一 `Unavailable` / `Blocked`；admission state 由
Nimi App registry 拥有，package readiness 由 package/runtime projection
拥有。

## D-HOME-006 — Agent Chat Placement

`MUST`：Agent Chat 是 Home 内 in-shell reference surface（`P-HOME-006`）。
其在 shell 中的 placement、入口、与 UI navigation 由本契约拥有。

`MUST NOT`：Wave 1 内，Agent Chat surface 不得在 hosted shell 层拥有
transcript / history / identity / grant / memory / `ConversationAnchor`
truth。这些 ownership 由 Wave 4 permission fabric 接管。

## D-HOME-007 — AIScopeRef Enforcement

`MUST`：Agent Chat 执行 path（包括任何调用 Runtime AI execution 的
shell-internal flow）必须显式携带 `AIScopeRef`（`P-AISC-001`、
`S-AICONF-003`）。

mechanical guard：`check:home-shell-aiscoperef-required`，required-before:
Wave 1 implementation close。

## D-HOME-008 — No Private Runtime Path

`MUST NOT`：hosted shell 任何代码层不得 import：

- `runtime/internal/**`
- Realm private client / private transport
- SDK private internals

mechanical guard：`check:home-shell-no-runtime-internal-import`，
required-before: Wave 1 implementation close。

## D-HOME-009 — Runtime / Account / Diagnostics Surface Consumption

`MUST`：Runtime health、app health、account、settings、diagnostics、
developer-mode 等 surface 必须通过 SDK typed path 消费 Runtime / Realm /
Cognition projection。

`MUST NOT`：不得在 renderer 层直接 fetch Runtime gRPC、Realm REST、或
Cognition raw artifact；不得绕过 SDK 的 typed projection 形成 shell-local
authority。

## D-HOME-010 — Self-Update UI Projection

`MUST`：self-update UI 消费 `P-SUPD-002` 与 `P-PKGREL-006` 的 fail-closed
投影；UI 文案可重命名状态，但必须保留 typed distinction（`failed`、
`rollback-required`、`verification-failed`、`unsupported`、
`stale-projection`）。

`MUST NOT`：self-update UI 不得 mutate Runtime-owned selected source
record 或 local environment dependency state（`P-SUPD-005`）。

## D-HOME-011 — First Screen Rule

`MUST`：Home 首屏必须落在 Platform `P-HOME-010` 定义的 usable product
control。允许首屏直接展示 cold-start fail-closed 状态（含 setup-required、
needs-confirmation、in-progress），但必须同时给到可操作控制（setup、
account、Runtime health、settings、Apps 入口）。

`MUST NOT`：首屏不得是 marketing copy、landing page、第三方 placeholder、
或 generic loading 屏。

## D-HOME-012 — Failure Projection As First-Class Surface

`MUST`：`failure-projection` 是 surface registry 的一等 surface。任何
upstream authority 非 ready 状态都必须经由该 surface 显式呈现给用户。

`MUST NOT`：不得把 multiple 非 ready 状态压缩成单一 `unavailable` /
`offline` 文案；不得隐藏失败原因或 dependency family identity。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-self-update-contract.md` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/platform/kernel/nimi-package-release-contract.md` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/desktop/kernel/ui-shell-contract.md` — desktop shell 既有 `D-SHELL-*` 与本契约 placement 互不重叠
- `.nimi/spec/desktop/kernel/self-update-contract.md` — desktop-host 实现细节
- `.nimi/spec/desktop/kernel/ai-profile-config-contract.md` — `D-AIPC-001..D-AIPC-012`
- `.nimi/spec/desktop/kernel/agent-chat-behavior-contract.md` — `D-LLM-022..D-LLM-026`
- `.nimi/spec/sdk/kernel/ai-config-surface-contract.md` — `S-AICONF-001..S-AICONF-006`
- `.nimi/spec/sdk/kernel/local-environment-projection-contract.md` — `S-RUNTIME-119`
- `.nimi/spec/desktop/kernel/tables/nimi-home-surfaces.yaml`

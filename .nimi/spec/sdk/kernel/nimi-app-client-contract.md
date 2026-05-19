# SDK Nimi App Client Contract

> Owner Domain: `S-APP-*`

## Scope

定义 SDK 对 Platform `Nimi App` admission / registry / install / launch
authority 的 typed consumer surface。本契约确保 SDK 是 app / developer 对
Nimi App lifecycle 的唯一接入入口；Desktop hosted shell（D-HOME-004 /
D-HOME-005）通过 SDK projection 投影 Apps。

## S-APP-001 — Sole Admitted Access Path

`MUST`：SDK Nimi App client surface 是 app / developer / Desktop hosted
shell 对 Nimi App install / update / uninstall / launch / status /
health-repair 的唯一 admitted access path。

`MUST NOT`：app / developer / shell 不得：

- 绕过 SDK 直接读写 Platform `nimi-app-registry.yaml`
- 绕过 SDK 直接调用 Runtime app registration 私有 RPC
- 私自实现 installer / package-manager / source-selector 逻辑

## S-APP-002 — Logical Operation Set

`MUST`：SDK 暴露以下 logical operation：

- `app.list()` — 列出当前 ordinary visible Nimi App 集合。该集合必须来自
  Platform registry/package projection and must filter to
  `admission_status=admitted` + `ordinary_visibility=ordinary-visible`.
- `app.get(appId)` — 获取单个 app admission row 与 projection state。
- `app.install(appId, options?)` — 触发 Platform-mediated install
  flow；返回 typed job projection。
- `app.update(appId)` — 触发 Platform-mediated update flow；遵守
  `P-PKGREL-007` 三 surface 独立性。
- `app.uninstall(appId)` — 触发 Platform-mediated uninstall flow。
- `app.launch(appId, scopeRef)` — 触发 Runtime-mediated launch；必须
  携带 canonical `AIScopeRef`（`P-AISC-001`）。
- `app.status(appId)` — 获取 app health/repair projection state。
- `app.subscribe(callback)` — 订阅 app lifecycle 事件；host-local
  event stream。
- `app.healthRepair(appId, action)` — 触发 repair flow，仅 admit 显式
  action token（cancel / retry / repair / reinstall）。

## S-APP-003 — Mandatory AIScopeRef On Launch

`MUST`：`app.launch(appId, scopeRef)` 必须接收 canonical `AIScopeRef`
（`P-AISC-001`、`S-AICONF-003`）。

`MUST NOT`：SDK 不得从 active chat、renderer-local current app、或默认
scope 隐式推断 launch scope；不得允许 caller 省略 `scopeRef`。

## S-APP-004 — Non-Owner Of Installer / Selector / Marketplace

`MUST NOT`：SDK Nimi App client surface 不拥有：

- installer / package-manager / PATH / source-selector 逻辑
- marketplace / economy / review / kill-switch truth
- Nimi App admission decision（属于 Platform `P-NAPP-*`）
- runtime registration / sandbox / process supervision truth（属于
  Runtime）
- GitHub/npm/source workspace discovery truth

## S-APP-005 — Typed Projection State

`MUST`：所有 logical operation 返回 typed projection state，与 Platform
`P-NAPP-008` health/repair fail-closed semantics 对齐。

`MUST NOT`：不得从 transfer completion、endpoint reachability、process
liveness、file existence 推断 `ready`；不得通过 generic `unavailable`
collapse 多种 fail-closed reason。

## S-APP-006 — Projection Family Reuse

`MUST`：SDK Nimi App client surface 复用 `S-AICONF-001..S-AICONF-006`
与 `S-RUNTIME-119` 的 typed projection paths；与 factory AIProfile
selection / runtime local environment 的 binding 通过这些 projection
一致表达。

`MUST NOT`：不引入第二套 projection family；不暴露 raw runtime / realm /
cognition transport。

## S-APP-007 — No Fallback Knob

`MUST`：错误返回 typed error，遵守 `S-AICONF-002` no-fallback 模式。

`MUST NOT`：不暴露 `{ fallback: 'allow' }` 类参数；不静默降级到 partial
install / partial launch；不把 Runtime fail-close 隐藏为 success。

## S-APP-008 — Subscription Scope

`MUST`：`app.subscribe(callback)` 仅承载 app lifecycle 事件流（installed /
updated / uninstalled / launching / launched / failed / repair-required
等 typed event）。

`MUST NOT`：subscription 不承载 audit / permission / spend 事件；Wave 4
permission fabric 与 Realm audit 拥有 audit truth。

## S-APP-009 — Ordinary Visibility Filter

`MUST`：SDK `app.list()` and Desktop Apps consumers must only project apps whose
registry row resolves as ordinary visible:

- `admission_status=admitted`
- `ordinary_visibility=ordinary-visible`
- package kind is admitted
- release descriptor resolves
- trust/runtime/permission/storage policy refs resolve

Avatar must not appear in `app.list()` for ordinary Apps, even when an internal
registry row exists for bundled package/update coordination.

`MUST NOT`：SDK must not expose unadmitted workspace apps, app-local spec rows,
Mods, Extensions, Avatar hidden-internal rows, or source-discovered packages as
ordinary Apps.

## S-APP-010 — Install Descriptor Verification

`MUST`：`app.install(appId, options?)` must resolve the admitted release
descriptor before any download. For external artifacts it must compute `sha256`
over downloaded bytes and compare it with the descriptor before unpacking,
registration, execution, or installed projection mutation.

`MUST NOT`：SDK must not perform direct `npm install`, `npx`, direct mutable
GitHub clone, source build/run, or lifecycle script execution as ordinary-user
install truth. Digest mismatch must fail closed and must not be projected as
partial success.

## S-APP-011 — Install Storage Projection

`MUST`：SDK install/uninstall/status projections must preserve the app storage
root split:

- release payloads: `<nimi_data>/apps/<app-id>/releases/<version>`
- durable data: `<nimi_data>/apps/<app-id>/data`
- cache: `<nimi_data>/apps/<app-id>/cache`
- temp: `<nimi_data>/apps/<app-id>/tmp`

Uninstall removes release payloads by default and keeps durable data unless the
user explicitly confirms destructive deletion.

## Fact Sources

- `.nimi/spec/sdk/kernel/ai-config-surface-contract.md` — `S-AICONF-001..S-AICONF-006`
- `.nimi/spec/sdk/kernel/local-environment-projection-contract.md` — `S-RUNTIME-119`
- `.nimi/spec/sdk/kernel/surface-contract.md` — `S-SURFACE-*`
- `.nimi/spec/sdk/kernel/error-projection.md` — `S-ERROR-*`
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-012`
- `.nimi/spec/platform/kernel/mod-extension-retirement-contract.md` — `P-MOEX-001..P-MOEX-006`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-app-trust-tiers.yaml`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-012`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/runtime/kernel/local-engine-contract.md` — `K-LENG-024..K-LENG-028`

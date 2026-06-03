# Mod / Extension Retirement Contract

> Owner Domain: `P-MOEX-*`

## Scope

固化 Public Mod / Public Extension 的 non-admission 决议，记录现有
`nimi-hook`、Desktop mod governance、mod workspace、SDK mod contract surface
的 developer / internal / retirement 边界，并锁定 `Shared Nimi Content
Pack` 的 non-admission 边界。

本契约固化 Public Mod / Public Extension non-admission 与 retired surface
边界。

## P-MOEX-001 — Public Mod / Public Extension Non-Admission

`MUST`：Public Mod 与 Public Extension 不是 Nimi 新一轮产品的 admitted
external installable / distributable / user-authorized product category。

`MUST NOT`：registry / SDK / Apps / install
gateway / release channel 不得通过任何 alias 重新引入 Public Mod 或
Public Extension。

## P-MOEX-002 — Retired (Existing Mod / Hook Surfaces)

`RETIRED`：既有 Mod / Hook / runtime-mod / SDK mod surface 已完成 physical
retirement execution。`.nimi/spec/desktop/kernel/mod-governance-contract.md`、
`.nimi/spec/desktop/kernel/hook-capability-contract.md`、
`.nimi/spec/desktop/kernel/tables/mod-*`、
`.nimi/spec/desktop/kernel/tables/hook-*`、
`.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml`、
`.nimi/spec/sdk/kernel/mod-contract.md` 等存量 active authority 文件已撤回；
对应 SDK exports、runtime CLI、Desktop / Web consumer surfaces、scripts / CI
guards 与 docs active references 已移除。

`MUST NOT`：上述 retired surfaces 不得作为普通用户产品入口、Nimi App、
外部生态接入点、第三方 SDK / API 公开承诺、或 future reserved namespace
重新出现。任何复活 Mod / Hook / runtime-mod / SDK mod surface 的提案必须
重新通过显式 admission，并不得复用 retired 文件、路径或命名作为兼容层。

`MUST`：retirement closeout audit 必须确认 parent workspace active
`nimi-mods` references 已清理或经 admitted allowlist 处置；历史归档与本地
审计证据只可作为追溯材料，不得成为 active authority。

## P-MOEX-002.a — Physical Retirement Anti-Targets

`MUST NOT`：以下命名模式禁止在本仓库重新引入为 registry / SDK export /
runtime CLI / desktop UI route / Tauri command / npm package name / URL path /
locale namespace / script name / docs link / descriptor identity：

- `mod-*` / `Mod*` / `nimi-mod*` / `@nimiplatform/mod-*`
- `mod-hub` / `mod-workspace` / `mod-codegen` / `mods-panel` / `runtime-mod`
- `inter-mod` / `mod-governance` / `mod-extension`
- `hook-capability` / `hook-allowlist` / `turn-hook-points`
- `modId` / `desktop-mod` / `CreatorMods*` / `/mods/` /
  `/desktop/mod-system`

The guard must cover identity shape, not only filenames. A field, type,
descriptor, route, generated SDK service, docs URL, locale namespace, script,
or test fixture that preserves Mod/Hook identity is an active anti-target even
when the surrounding feature has been renamed.

`MUST`：mechanical guard `check:p-moex-anti-targets` 必须在 physical
retirement true-close 前覆盖上述模式，并在 true-close 后持续阻断这些模式
作为 active product / API / command / package surface 回流。

## P-MOEX-003 — No Shared Nimi Content Pack Channel

`MUST`：Nimi 不创建共享的 `Nimi Content Pack` 产品 / channel。

`MUST NOT`：Registry / Apps / SDK 不得引入跨 app 的通用内容包
admission；任何"通用内容渠道"提案视为 reopen condition。

## P-MOEX-004 — App-Internal Content Package Boundary

`MUST`：App-internal content packages（Avatar Live2D / VRM / voice / persona
assets，或其他 app 的 prompt / knowledge / workflow bundle 等）由各自 app
或显式 admit 的 domain-specific upstream authority 拥有。

`MUST NOT`：上述 content package 不得被错误归类为 Nimi App、Mod、Extension、
或共享 content channel。

## P-MOEX-005 — Retired (Asset Market Disposition)

`RETIRED`：Asset Market 已完全退出 Nimi 一方应用 admission（连同 backend
实现、avatar-package projection 链路与 spec 树一起撤回）。本条规则保留
为退役占位，不再承载 active normative 行为。任何复活 Asset Market 的提案
必须重新通过显式 admission row 并重新写入新规则。

## P-MOEX-006 — Mechanical Guard Registration

`MUST`：mechanical guard `check:no-public-mod-extension-admission` 在
`enforcement-gates-required.md` 中注册，并 block：registry / package rows
admitting public Mods or Extensions，
以及任何 alias 重新引入共享内容包 channel。

`MUST`：mechanical guard `check:p-moex-anti-targets` 是独立的 full-surface
retirement guard。它不得只是 `check:no-public-mod-extension-admission` 的别名；
它必须覆盖 `P-MOEX-002.a` 的 filename / symbol / field / URL / docs / i18n /
script / generated SDK anti-targets。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-011; P-NAPP-013..P-NAPP-030`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`

# Mod / Extension Retirement Contract

> Owner Domain: `P-MOEX-*`

## Scope

固化 Public Mod / Public Extension 的 non-admission 决议，记录现有
`nimi-hook`、Desktop mod governance、mod workspace、SDK mod contract surface
的 developer / internal / retirement 边界，并锁定 `Shared Nimi Content
Pack` 与 `Asset Market` 的 non-admission 与 admission 边界。

本契约固化 Wave 0 D6 / D8 / D12 决议（参见
`mod-extension-retirement-map.md`、`asset-market-disposition.md`）。

## P-MOEX-001 — Public Mod / Public Extension Non-Admission

`MUST`：Public Mod 与 Public Extension 不是 Nimi 新一轮产品的 admitted
external installable / distributable / user-authorized product category。

`MUST NOT`：registry / SDK / Apps / install
gateway / release channel 不得通过任何 alias 重新引入 Public Mod 或
Public Extension。

## P-MOEX-002 — Existing Surfaces As Developer / Internal / Retirement Only

`MUST`：现有 `.nimi/spec/desktop/kernel/mod-governance-contract.md`、
`.nimi/spec/desktop/kernel/hook-capability-contract.md`、
`.nimi/spec/desktop/kernel/tables/mod-*`、
`.nimi/spec/desktop/kernel/tables/hook-*`、
`.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml`、
`.nimi/spec/sdk/kernel/mod-contract.md`、`nimi-mods/` workspace 等存量
surface 仅作为 developer / internal / retirement surface 存在。

`MUST NOT`：上述 surface 不得作为普通用户产品入口、Nimi App、外部生态接入
点、或第三方 SDK / API 公开承诺。Wave 5 之前必须完成 audit / freeze /
internalization，并按 `desktop-kernel-supersession-schedule.md` 顺序退役。

## P-MOEX-003 — No Shared Nimi Content Pack Channel

`MUST`：Nimi 不创建共享的 `Nimi Content Pack` 产品 / channel。

`MUST NOT`：Registry / Apps / SDK 不得引入跨 app 的通用内容包
admission；任何"通用内容渠道"提案视为 reopen condition（参见 Wave 0
`mod-extension-retirement-map.md`）。

## P-MOEX-004 — App-Internal Content Package Boundary

`MUST`：App-internal content packages（Avatar Live2D / VRM / voice / persona
assets，ParentOS prompt / knowledge / workflow bundle 等）由各自 app 或
显式 admit 的 domain-specific upstream authority 拥有。

`MUST NOT`：上述 content package 不得被错误归类为 Nimi App、Mod、Extension、
或共享 content channel。

## P-MOEX-005 — Asset Market Disposition

`MUST`：Asset Market 不是通用的 Nimi 内容渠道。如果 Asset Market 作为
controlled first-party app 或 domain-specific upstream package authority 被
admit，必须经过显式 admission row + Platform / Runtime / Realm 边界审计
（参见 Wave 0 `asset-market-disposition.md`）。

`MUST NOT`：Asset Market 不得：

- 升格为通用 content marketplace
- 替代 Nimi App 注册
- 替代 Wave 4 permission fabric
- 替代 Runtime materializer 的 selected source record authority

## P-MOEX-006 — Mechanical Guard Registration

`MUST`：mechanical guard `check:no-public-mod-extension-admission` 在
`enforcement-gates-required.md` 中以 `Required before: Wave 3 close` 注册，
并 block：registry / package rows admitting public Mods or Extensions，
以及任何 alias 重新引入共享内容包 channel。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-012`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/spec/desktop/kernel/mod-governance-contract.md` — developer/internal retirement only
- `.nimi/spec/desktop/kernel/hook-capability-contract.md` — developer/internal retirement only
- `.nimi/spec/sdk/kernel/mod-contract.md` — developer/internal retirement only
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/mod-extension-retirement-map.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/asset-market-disposition.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/desktop-kernel-supersession-schedule.md`

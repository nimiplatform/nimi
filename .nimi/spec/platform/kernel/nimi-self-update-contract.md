# Nimi Self-Update Contract

> Owner Domain: `P-SUPD-*`

## Scope

定义 `Nimi` 产品的 self-update authority。本契约拥有 release channel
identity、trust posture、compatibility gates、rollback policy，并锁定与
`Nimi Home` 用户面、Runtime daemon handoff、App registry 与 Runtime local
environment 之间的非 owner 边界。

## P-SUPD-001 — Self-Update Policy Owner

`MUST`：Platform 拥有产品 self-update policy、release channel identity、
trust posture、compatibility gates、与 rollback policy。

`MUST NOT`:

- 不得让 Desktop host、Nimi Home shell、SDK consumer、或 first-party
  Nimi App 自创 release channel 或 rollback policy。
- 不得让 Runtime materializer 通过 self-update 通道安装/更新模型或本地
  依赖。

## P-SUPD-002 — Home User Surface Owner

`MUST`：`Nimi Home` 拥有 user-facing self-update discovery、consent、
progress、restart UI、rollback UI、与 diagnostics projection。

`MUST NOT`：Nimi Home 不得自创 channel identity、自定义 pubkey/endpoint
policy、或绕过本契约的 fail-closed semantics（`P-SUPD-006`）。

## P-SUPD-003 — Runtime Handoff Owner

`MUST`：Runtime 拥有 daemon lifecycle handoff、stop/start/restart status、
与更新后真实本地 health。

`MUST NOT`：Runtime 不得在 self-update 路径中替代 selected source record
更新或 model catalog 更新（这些归 `P-SUPD-005`）。

## P-SUPD-004 — App Registry Update Boundary

`MUST`：Wave 3 Nimi App registry 拥有 app package 更新事实。Nimi
self-update 不得替代 app package 更新；app package 更新也不得替代 Nimi
self-update。

## P-SUPD-005 — Selected Source Record Non-Mutation Rule

`MUST NOT`：Nimi self-update 路径不得 mutate Runtime-owned selected source
record、`local-environment-dependencies.yaml` 状态、或
`K-LENV-MAT-*` / `K-LENV-ACT-*` 管理的 model / dependency truth。

Runtime local environment materializers 仍按 `K-LENG-024..K-LENG-028` 独立
负责 model / dependency 的下载、verification、selected source record
promotion。

## P-SUPD-006 — Fail-Closed Self-Update

`MUST`：缺少 release evidence、verification 失败、signature mismatch、
rollback 必须、daemon handoff 不可达、或 compatibility gate 不通过时，
Nimi Home 必须显式投影对应 fail-closed 状态（`failed`、
`rollback-required`、`verification-failed`、`unsupported`、
`stale-projection` 等）。

`MUST NOT`：不得静默升级、不得隐式跳过 verification、不得以"latest"为
ready 投影。

## P-SUPD-007 — Existing Desktop Self-Update Supersession

`MUST`：现有 `.nimi/spec/desktop/kernel/self-update-contract.md` 继续保留
为 desktop-host 实现细节（atomic Desktop release unit、bundled runtime
staging、updater pubkey/endpoint 实现等）。它在本 Platform policy 之下作为
desktop-hosted 实现层级；rename 产品文案为 `Nimi` 时按
`naming-and-kernel-ontology.md` 与 `desktop-kernel-supersession-schedule.md`
执行。

`MUST NOT`：不得把 Desktop 自更新合同当成 Platform 产品 self-update
policy 平级 owner。

## P-SUPD-008 — Web Self-Update Boundary

`MUST NOT`：本契约不 admit web self-update 路径。如需要 web 自更新形态，
必须由未来一次显式 `web-release-contract.md` cut admit。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-package-release-contract.md` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/kernel/web-release-contract.md` — `P-WEB-*`
- `.nimi/spec/desktop/kernel/self-update-contract.md` — desktop-host 实现细节
- `.nimi/spec/runtime/kernel/local-engine-contract.md` — `K-LENG-024..K-LENG-028`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md`
- `.nimi/spec/runtime/kernel/local-environment-consumer-activation-contract.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/authority-supersession-map.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/desktop-kernel-supersession-schedule.md`

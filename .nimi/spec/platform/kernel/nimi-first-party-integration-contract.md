# Nimi First-Party Integration Contract

> Owner Domain: `P-FPI-*`

## Scope

定义首批 first-party Nimi App（Wave 5 hardcut targets：Avatar 与
ParentOS）通过 Platform Nimi App registry / SDK Nimi App client / SDK
Nimi permission client 与 Runtime 集成的产品级 authority。本契约不实现
app 代码、Tauri packaging、Runtime 集成本身；它锁定 first-party 集成的
contract 关系与"hard cut 之后无 standalone ordinary-user product truth"
的边界。

## P-FPI-001 — First-Party Hardcut Targets

`MUST`：Wave 5 first-party hardcut targets 仅限 Avatar（`nimi.avatar`）
与 ParentOS（`nimi.parentos`），与
`first-party-hardcut-scope-ledger.md` 保持一致。

`MUST NOT`：不得在 Wave 5 product close 中使用 deferred first-party app
作为 evidence（参见 ledger 中 Forge、Asset Market、Moment、Polyinfo、
Shiji、Realm Drift、Lookdev、Video Food Map、Overtone 等条目）。

## P-FPI-002 — Single Registry Source

`MUST`：first-party app 集成消费 Wave 3
`tables/nimi-app-registry.yaml` 的对应 row，且 install / launch / update
/ uninstall / health / repair 必须通过 SDK Nimi App client surface
（`S-APP-001..S-APP-008`）。

`MUST NOT`：Wave 5 不得引入与 registry 并列的第二份 install / launch
truth；不得让 Desktop hosted shell 或 first-party app 自行实现安装逻辑。

## P-FPI-003 — Default Experience Alias Hint Consumption

`MUST`：first-party 集成应用 `default_experience_alias_ref` 通过
`aiProfile.apply(scopeRef, profileId)`（`S-AICONF-001`）进入 scope-bound
`AIConfig`（`D-AIPC-005`）。

`MUST NOT`：first-party app default-experience 绑定代码不得内嵌
provider / connector / engine / model 字符串常量（`P-DXP-008`、
`P-HOME-005`）。

## P-FPI-004 — Permission Scope Ref Consumption

`MUST`：first-party app 通过 SDK `S-PERM-*` 请求 Wave 4 admitted grant
list（`P-PERM-009`）。Avatar 与 ParentOS 的 grant list 必须严格匹配
`tables/nimi-app-registry.yaml` 中的 `permission_scope_ref` typed object
列表。

`MUST NOT`：不得通过 host bridge implementation detail 或 ad-hoc IPC
绕过 SDK permission client；不得在 grant lifecycle 之外授权 scope。

## P-FPI-005 — Runtime Registration Consumer Relationship

`MUST`：app 启动通过 `app.launch(appId, scopeRef)`（`S-APP-003`）触发
Runtime registration；registration mode 必须匹配 registry row 中的
`runtime_registration_mode`（当前 admitted 值集合：`app-managed`）。

`MUST NOT`：app 不得绕过 SDK Nimi App client 直接调用 Runtime registration
私有 RPC；不得在 launch path 中自行 sandbox / supervise 进程。

## P-FPI-006 — Avatar Master Gate Dependency

`MUST`：Avatar 集成实施必须满足下列任一前置条件：

- Avatar 产品化 master gate（参见 `avatar-master-gate-coordination.md`）
  对 Avatar 必需的 readiness 已 true-close
- Avatar master gate 明确 delegate Nimi App 集成 scope 到本 topic

在前置条件未满足前，`tables/nimi-app-registry.yaml` 的 Avatar row
`admission_status` 必须保持为 `gated_by_avatar_master_gate`。Wave 5
实施可以仅在前置条件满足后通过显式 admission 步骤把 Avatar 推升到
`admitted`。

`MUST NOT`：不得在 Avatar master gate 未清场前把 Avatar admission_status
切到 `admitted`。

## P-FPI-007 — No Standalone Ordinary-User Truth After Hard Cut

`MUST`：Wave 5 close 之后，Avatar 与 ParentOS 在 ordinary-user product
truth 层不得保留 standalone install / launch / update 路径；只允许
Nimi App registry 行作为 ordinary-user product truth。

`MUST NOT`：不得保留 standalone Avatar / ParentOS 安装包作为 ordinary-
user product channel；不得让 desktop hosted shell 暴露独立 Avatar /
ParentOS 入口绕过 Library / Discovery。

source-development workflows 可继续以 standalone 方式启动，但必须遵守
`P-FPM-004` 的 source-development marker rule。

## P-FPI-008 — Avatar Kernel Authority Retention

`MUST`：Avatar kernel authority 保持在 `.nimi/spec/avatar/**`。Wave 5
仅添加 Nimi App registry / SDK integration / migration contract，而不把
Avatar kernel 迁移到 app-local subordinate spec 路径下或降级为 app-local
spec admission。

`MUST NOT`：不得把 Avatar 视为 app-slice admission 真相
（`P-APP-*` 与 `P-NAPP-*` 是 orthogonal authority，参见
`P-NAPP-010`）。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-012`
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-010`
- `.nimi/spec/platform/kernel/agent-identity-floor-contract.md` — `P-AGID-001..P-AGID-008`
- `.nimi/spec/platform/kernel/default-experience-profile-contract.md` — `P-DXP-001..P-DXP-012`
- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-first-party-migration-contract.md` — `P-FPM-001..P-FPM-006`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/spec/sdk/kernel/nimi-app-client-contract.md` — `S-APP-001..S-APP-008`
- `.nimi/spec/sdk/kernel/nimi-permission-client-contract.md` — `S-PERM-001..S-PERM-008`
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — `D-HOME-001..D-HOME-012`
- `.nimi/spec/avatar` (kernel authority retained)
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/avatar-master-gate-coordination.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/first-party-hardcut-scope-ledger.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/authority-supersession-map.md`

# Nimi First-Party Integration Contract

> Owner Domain: `P-FPI-*`

## Scope

定义 first-party Nimi App hardcut target（Avatar）通过 Platform
Nimi App registry / SDK Nimi App client / SDK Nimi permission client 与
Runtime 集成的产品级 authority。本契约不实现 app 代码、Tauri packaging、
Runtime 集成本身；它锁定 first-party 集成的 contract 关系与"hard cut 之后
无 standalone ordinary-user product truth"的边界。

## P-FPI-001 — First-Party Hardcut Targets

`MUST`：first-party hardcut target 仅限当前 admitted
`tables/nimi-app-registry.yaml` row 集合（现为 Avatar，`nimi.avatar`）。

`MUST NOT`：不得在 first-party hardcut closeout 中使用 deferred first-party app
作为 evidence；只能使用当前 admitted registry rows 或明确准入的 app slice。

## P-FPI-002 — Single Registry Source

`MUST`：first-party app 集成消费 `tables/nimi-app-registry.yaml` 的对应
row，且 install / launch / update
/ uninstall / health / repair 必须通过 SDK Nimi App client surface
（`S-APP-001..S-APP-008`）。

`MUST NOT`：不得引入与 registry 并列的第二份 install / launch
truth；不得让 Desktop hosted shell 或 first-party app 自行实现安装逻辑。

## P-FPI-003 — AIProfile Selection Hint Consumption

`MUST`：first-party 集成应用 `ai_profile_selection_ref` 通过
`aiProfile.apply(scopeRef, profileId)`（`S-AICONF-001`）进入 scope-bound
`AIConfig`（`D-AIPC-005`）。

`MUST NOT`：first-party app factory AIProfile 绑定代码不得内嵌
provider / connector / engine / model 字符串常量（`P-AIPS-008`、
`P-HOME-005`）。

## P-FPI-004 — First-Party Authority Classification

`MUST`：first-party app 与第三方 app 使用同一 `P-PERM-015` 分类。Registry
`permission_requirements` 只声明真正面向用户的已准入 public permission；
当前 first-party rows 均为空列表。Built-in product/service operation 必须由
其 Platform/Runtime/Realm/Cognition product contract 精确准入，app-private
storage 与 app-owned commands 分别走 base entitlement 与 app-owned authority。

`MUST NOT`：first-party publisher/review status 不得生成 seed grant、扩大
第三方 permission、把 account/session/metering/profile/storage 伪装成 grant，
或经 ad-hoc IPC 代理 protected Nimi operation。

## P-FPI-005 — Runtime Registration Consumer Relationship

`MUST`：app 启动通过 `app.launch(appId, scopeRef)`（`S-APP-003`）触发
Runtime registration；registration mode 必须匹配 registry row 中的
`runtime_registration_mode`（当前 admitted 值集合：`app-managed`）。

`MUST NOT`：app 不得绕过 SDK Nimi App client 直接调用 Runtime registration
私有 RPC；不得在 launch path 中自行 sandbox / supervise 进程。

## P-FPI-006 — Avatar Master Gate Clearance

`MUST`：Avatar first-party integration now treats the Avatar productization
master gate as cleared for the default `nimi.avatar` app. The canonical
`tables/nimi-app-registry.yaml` Avatar row must remain `admission_status:
admitted` while ordinary Apps exposure stays controlled by
`ordinary_visibility: hidden-internal`.

`MUST`：Avatar launch must register the `nimi.avatar` local first-party Runtime
app instance before reading Runtime account session status. Account, agent,
permission, and storage checks must continue to fail closed through Runtime and
Platform registry truth.

`MUST NOT`：不得恢复 standalone ordinary-user launch truth、parallel admission
truth，或通过 app-local session shim 绕过 Runtime `RegisterApp`。

## P-FPI-007 — No Standalone Ordinary-User Truth After Hard Cut

`MUST`：hard cut 之后，Avatar 在 ordinary-user product truth 层不得
保留 standalone install / launch / update 路径；只允许 Nimi App registry
行作为 ordinary-user product truth。

`MUST NOT`：不得保留 standalone Avatar 安装包作为 ordinary-user product
channel。Avatar remains hidden from ordinary Apps while package/update
coordination stays registry/package-owned.

source-development workflows 可继续以 standalone 方式启动，但必须遵守
`P-FPM-004` 的 source-development marker rule。

## P-FPI-008 — Avatar Kernel Authority Retention

`MUST`：Avatar kernel authority 保持在 `.nimi/spec/avatar/**`。first-party
integration 仅添加 Nimi App registry / SDK integration / migration
contract，而不把
Avatar kernel 迁移到 app-local subordinate spec 路径下或降级为 app-local
spec admission。

`MUST NOT`：不得把 Avatar 视为 app-slice admission 真相
（`P-APP-*` 与 `P-NAPP-*` 是 orthogonal authority，参见
`P-NAPP-010`）。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-011; P-NAPP-013..P-NAPP-015; P-NAPP-018..P-NAPP-029`
- `.nimi/spec/platform/kernel/nimi-app-local-admission-contract.md` — `P-NAPP-030..P-NAPP-032`
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-010`
- `.nimi/spec/platform/kernel/agent-identity-floor-contract.md` — `P-AGID-001..P-AGID-008`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-first-party-migration-contract.md` — `P-FPM-001..P-FPM-006`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/spec/sdks/kernel/nimi-app-client-contract.md` — `S-APP-001..S-APP-008`
- `.nimi/spec/sdks/kernel/nimi-permission-client-contract.md` — `S-PERM-001..S-PERM-008`
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — `D-HOME-001..D-HOME-012`
- `.nimi/spec/avatar` (kernel authority retained)

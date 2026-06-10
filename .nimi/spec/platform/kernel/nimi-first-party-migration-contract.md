# Nimi First-Party Migration Contract

> Owner Domain: `P-FPM-*`

## Scope

定义 first-party Nimi App hardcut target（Avatar）从 standalone
install path 迁移到 Nimi App registry 行的 product 级 migration authority。
本契约固化 `design.md` "First-Party Migration Policy" 决议，并锁定
migration failure fail-closed 状态机、source-development marker rule 与
no-silent-user-state-reset rule。

## P-FPM-001 — Required Migration Questions

`MUST`：first-party hardcut implementation 必须为每个 hardcut target 显式回答以下
问题，并把答案落到对应 app 的 migration plan：

1. 当前存在哪些 standalone Avatar 用户状态？
2. 哪些状态是 app-private、迁移后仍留在 app 内？
3. 哪些状态必须升级为 Nimi account / data / permission truth？
4. 哪些本地文件或设置变为 Nimi Home-managed install state？
5. 迁移失败时如何处理？
6. source-development 阶段可否同时存在 standalone 与 Nimi-managed 两份
   变体？

`MUST NOT`：在缺少完整答案前实施 hard cut；不得在 migration plan 留
未解析占位文本。

## P-FPM-002 — Migration Failure Fail-Closed State Machine

`MUST`：迁移路径 typed state set：

- `migration-pending`
- `migration-in-progress`
- `migration-failed`
- `migration-blocked`
- `migration-recoverable`
- `migration-completed`

UI / SDK / app 必须显式区分这些状态；Nimi Home 投影必须按
`P-COLD-001` 与 `P-NAPP-008` fail-closed 状态机一致。

`MUST NOT`：不得用单一 `unavailable` 文案折叠多个 migration failure
原因；不得静默成功。

## P-FPM-003 — No Silent User State Reset

`MUST`：migration 失败必须保留 explicit recoverable state；用户的
existing standalone state 不得被静默 reset、清空、或绕过 audit 重写。

`MUST NOT`：失败时不得：

- silently 生成全新 app identity
- 直接当成 empty success
- 留下 orphan user state 没有任何 reconcile 路径

## P-FPM-004 — Source-Development Marker Rule

`MUST`：source-development workflows 可继续 standalone 启动，但仅在显
式 developer execution marker（如 `NIMI_DEV_MODE=true`、CLI
`--dev` flag、明确的 IDE-task launch profile）之下进行。

`MUST NOT`：source-dev 路径不得：

- 出现在 ordinary-user 安装包
- 出现在 release channel 默认值
- 借 staging release channel 隐式升格成 ordinary-user product truth

## P-FPM-005 — Zero Dual-Track Period After Hard Cut

`MUST`：每个 hardcut target 的迁移计划必须显式声明 cutover window：

- cutover 起止时间 / 触发条件
- 在 cutover 后 ordinary-user product truth 中只允许 Nimi-managed
  variant
- 任何 standalone variant 必须在 cutover 后立即停止作为 ordinary-user
  product 入口

`MUST NOT`：cutover 之后不得保留 standalone / Nimi-managed 双轨 ordinary-
user product truth。

## P-FPM-006 — Per-App Implementation Plan Requirement

`MUST`：first-party hardcut implementation 必须为每个 first-party hardcut target
产生：

- `P-FPM-001` 的完整问题答案
- `P-FPM-005` 的 cutover window 声明
- `P-FPM-002` 状态机在 UI / SDK / app 层的映射
- audit / rollback / re-run 的具体步骤

`MUST NOT`：不得用通用 boilerplate plan 替代 per-app plan；不得跨 app
共用一个 cutover window。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-first-party-integration-contract.md` — `P-FPI-001..P-FPI-008`
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-011; P-NAPP-013..P-NAPP-030`
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-010`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/kernel/nimi-package-release-contract.md` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/kernel/nimi-self-update-contract.md` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — `D-HOME-001..D-HOME-012`

# Desktop Mod Codegen Contract

> Owner Domain: `D-CODEGEN-*`

## D-CODEGEN-001 — 治理原则

codegen mod 是受约束生成，不是任意代码执行入口。以下原则适用于所有 codegen 规则：

- **治理链必经**：codegen mod 不得绕过 mod 八阶段治理链。
- **受约束生成**：codegen 产物受 manifest、capability、import boundary 三重约束。
- **最小权限**：默认最小权限，越权调用必须 fail-close 并可审计。
- **Source-type 隔离**：`codegen` source_type 绑定独立 allowlist，不复用 sideload 放权。

## D-CODEGEN-010 — Manifest 约束

codegen 产物 manifest 必须满足以下全部约束：

- **ID 前缀**：manifest `id` 必须使用 `world.nimi.user.` 前缀。
- **固定入口**：manifest `entry` 固定为 `./dist/index.js`。
- **Capabilities 必填**：manifest `capabilities` 字段必填。`permissions` 字段已退役；codegen 产物与预检链不得输出或接受 legacy permissions 字段。
- **Version window 必填**：`nimi.minVersion/maxVersion` 必填。
- **Hash 必填**：manifest hash 必须存在并由构建产出回填。
- **Wildcard 禁止**：禁止 `*`、`:*`、`.*` wildcard 能力声明。

执行命令：

- `pnpm check:no-legacy-mod-permissions-field`

## D-CODEGEN-016 — 导出与导入面

codegen mod 的模块边界约束：

- **Runtime 导出契约**：生成入口必须导出 `createRuntimeMod`，且运行时能力不超过 manifest 声明。
- **稳定导入面**：setup 仅允许使用 `@nimiplatform/sdk/mod`，以及在确有需要时使用 `@nimiplatform/sdk/mod/shell`、`@nimiplatform/sdk/mod/lifecycle`。

## D-CODEGEN-020 — Capability Tier 模型

codegen mod 能力分三级治理（完整列表见 `codegen-capability-tiers.yaml`）：

- **T0 auto_allow**：自动授权最小集合（runtime text generate/stream、ui-extension.app.*、data-api.user-*、audit/meta.read.self）。
- **T1 require_consent**：必须显式用户同意（media image/video/tts/stt、embedding、voice、route、local artifacts、core data query）。
- **T2 hard_deny**：硬拒绝，不允许授权落地（turn hook、inter-mod、network、filesystem、process、economy-write、identity-write、platform-cloud-write、audit.read.all、action.*、meta.read.all）。
- **运行时 grant 判定**：运行时按 grant/denial 实时判定 capability，不允许静态绕过。

**Fact Source**: `codegen-capability-tiers.yaml`

## D-CODEGEN-030 — Import 边界

codegen mod 的导入约束（完整列表见 `codegen-import-allowlist.yaml`）：

- **Allowlist**：允许导入 `@nimiplatform/sdk/mod`、`@nimiplatform/sdk/mod/shell`、`@nimiplatform/sdk/mod/lifecycle`。
- **Denylist**：禁止导入 `@nimiplatform/sdk/mod/host`、`@nimiplatform/sdk/mod/internal/*` 与第三方未登记依赖。
- **V1 Closed APIs**：禁止 turn/inter-mod/action 注册入口。
- **High-risk deny**：禁止外部网络、动态执行和高风险本地能力直连。

**Fact Source**: `codegen-import-allowlist.yaml`

## D-CODEGEN-040 — Build & Preflight

codegen bundle 构建与预检链：

- **Build 基线**：codegen bundle 构建参数由固定 esbuild 基线控制。
- **Manifest preflight**：preflight 必须做 manifest schema 校验。
- **Capability preflight**：preflight 必须做 capability tier 校验。
- **Static scan preflight**：preflight 必须做 bundle 静态扫描。
- **Deny pattern set**：静态扫描禁用模式由 `codegen-static-scan-deny-patterns.yaml` 管理。
- **Bundle size threshold**：bundle 大小必须受阈值约束。

**Fact Source**: `codegen-static-scan-deny-patterns.yaml`

## D-CODEGEN-050 — Reload 事务

codegen mod reload 事务化与资源安全：

- **事务化流程**：reload 必须执行 disable/unload old → install/load new 的事务化流程。
- **Teardown 安全**：reload/disable 必须可回收资源，禁止幽灵副作用累积。

## D-CODEGEN-060 — Acceptance Gates

codegen mod 验收门禁（完整列表见 `codegen-acceptance-gates.yaml`）：

- **E2E gate**：描述到可交互产物的端到端链路必须可验证。
- **Governance trace gate**：所有 codegen 安装必须留下完整治理链轨迹。
- **Capability gate**：T2 拒绝、T1 确认是硬门禁。
- **Deny audit gate**：拒绝路径必须产生日志与审计证据。
- **Static scan gate**：命中禁用模式必须阻断安装。
- **Reload leak gate**：连续 reload 不得出现重复注册与泄漏。
- **Scenario coverage gate**：至少三类场景稳定可运行。
- **Evidence routing**：执行证据必须进入 `nimi-coding/.local/report/*`。

**Fact Source**: `codegen-acceptance-gates.yaml`

## D-CODEGEN-070 — Hard Gates & Rollback

codegen mod 硬门禁与回滚约束：

- **Permission > Function**：权限闸门优先级高于功能闸门。
- **Audit hard gate**：无审计记录视为失败。
- **Lifecycle hard gate**：生命周期异常不可进入启用态。
- **Security hard gate**：静态扫描与导入边界任一失败都必须阻断。
- **Feature-flag rollback**：可通过功能开关进行回滚，且不污染既有 mod 路径。
- **Transaction rollback**：安装任一步失败必须回滚，不写入启用状态。

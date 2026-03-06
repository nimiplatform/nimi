# Desktop Mod Codegen Contract

> Owner Domain: `D-CODEGEN-*`

## D-CODEGEN-001 Governance Chain Required

codegen mod 不得绕过 mod 八阶段治理链。

## D-CODEGEN-002 Constrained Generation

codegen 是受约束生成，不是任意代码执行入口。

## D-CODEGEN-003 Least Privilege

默认最小权限，越权调用必须 fail-close 并可审计。

## D-CODEGEN-004 Source-Type Isolation

`codegen` source_type 绑定独立 allowlist，不复用 sideload 放权。

## D-CODEGEN-010 Manifest ID Prefix

manifest `id` 必须使用 `world.nimi.user.` 前缀。

## D-CODEGEN-011 Fixed Entry

manifest `entry` 固定为 `./dist/index.js`。

## D-CODEGEN-012 Capabilities Required

manifest `capabilities` 字段必填。
`permissions` 字段已退役；codegen 产物与预检链不得输出或接受 legacy permissions 字段。

执行命令：

- `pnpm check:no-legacy-mod-permissions-field`

## D-CODEGEN-013 Version Window Required

`nimi.minVersion/maxVersion` 必填。

## D-CODEGEN-014 Hash Required

manifest hash 必须存在并由构建产出回填。

## D-CODEGEN-015 Wildcard Capability Forbidden

禁止 `*`、`:*`、`.*` wildcard 能力声明。

## D-CODEGEN-016 Runtime Export Contract

生成入口必须导出 `createRuntimeMod`，且运行时能力不超过 manifest 声明。

## D-CODEGEN-017 Stable Import Surface

setup 仅允许使用 `@nimiplatform/sdk/mod/*` 稳定导入面。

## D-CODEGEN-020 Capability Tier T0

T0 能力为自动授权最小集合。

## D-CODEGEN-021 Capability Tier T1

T1 能力必须显式用户同意。

## D-CODEGEN-022 Capability Tier T2

T2 能力硬拒绝，不允许授权落地。

## D-CODEGEN-023 Runtime Grant Enforcement

运行时按 grant/denial 实时判定 capability，不允许静态绕过。

## D-CODEGEN-030 Import Allowlist

允许导入集合由 `codegen-import-allowlist.yaml` 管理。

## D-CODEGEN-031 Import Denylist

禁止导入 host/internal 与第三方未登记依赖。

## D-CODEGEN-032 Turn/InterMod/Action Closed

V1 禁止 turn/inter-mod/action 注册入口。

## D-CODEGEN-033 High-Risk API Deny

禁止外部网络、动态执行和高风险本地能力直连。

## D-CODEGEN-040 Build Baseline

codegen bundle 构建参数由固定 esbuild 基线控制。

## D-CODEGEN-041 Manifest Preflight

preflight 必须做 manifest schema 校验。

## D-CODEGEN-042 Capability Preflight

preflight 必须做 capability tier 校验。

## D-CODEGEN-043 Static Scan Preflight

preflight 必须做 bundle 静态扫描。

## D-CODEGEN-044 Deny Pattern Set

静态扫描禁用模式由 `codegen-static-scan-deny-patterns.yaml` 管理。

## D-CODEGEN-045 Bundle Size Threshold

bundle 大小必须受阈值约束。

## D-CODEGEN-050 Reload Transaction

reload 必须执行 disable/unload old -> install/load new 的事务化流程。

## D-CODEGEN-051 Teardown Safety

reload/disable 必须可回收资源，禁止幽灵副作用累积。

## D-CODEGEN-060 E2E Gate

描述到可交互产物的端到端链路必须可验证。

## D-CODEGEN-061 Governance Trace Gate

所有 codegen 安装必须留下完整治理链轨迹。

## D-CODEGEN-062 Capability Gate

T2 拒绝、T1 确认是硬门禁。

## D-CODEGEN-063 Deny Audit Gate

拒绝路径必须产生日志与审计证据。

## D-CODEGEN-064 Static Scan Gate

命中禁用模式必须阻断安装。

## D-CODEGEN-065 Reload Leak Gate

连续 reload 不得出现重复注册与泄漏。

## D-CODEGEN-066 Scenario Coverage Gate

至少三类场景稳定可运行。

## D-CODEGEN-067 Evidence Routing

执行证据必须进入 `dev/report/*`。

## D-CODEGEN-070 Permission Hard Gate

权限闸门优先级高于功能闸门。

## D-CODEGEN-071 Audit Hard Gate

无审计记录视为失败。

## D-CODEGEN-072 Lifecycle Hard Gate

生命周期异常不可进入启用态。

## D-CODEGEN-073 Security Hard Gate

静态扫描与导入边界任一失败都必须阻断。

## D-CODEGEN-074 Feature-Flag Rollback

可通过功能开关进行回滚，且不污染既有 mod 路径。

## D-CODEGEN-075 Transaction Rollback

安装任一步失败必须回滚，不写入启用状态。

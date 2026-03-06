# SDK Testing Gates Contract

> Owner Domain: `S-GATE-*`

## S-GATE-001 Layered Test Policy

SDK 门禁分层：单元/模块、consumer smoke、合同/边界、runtime 投影、vNext 矩阵、覆盖率、provider 对齐、live smoke、发布一致性。

## S-GATE-010 Unit, Module & Consumer Baseline

关键子路径必须有单元与模块级测试基线；打包后的公开子路径必须可被独立消费者安装并导入。

执行命令：

- `pnpm --filter @nimiplatform/sdk test`
- `pnpm check:sdk-consumer-smoke`

## S-GATE-020 Contract & Boundary Gate

导入边界、公开命名、错误投影必须通过一致性检查。

## S-GATE-030 vNext Matrix Gate

vNext 能力矩阵必须与 runtime method groups 对齐。

## S-GATE-040 Mod/Scope Gate

mod/scope 子路径必须通过边界与语义回归。

## S-GATE-050 Runtime Projection Gate

runtime 子路径对 RPC 投影与 phase 状态必须一致。

## S-GATE-060 Coverage Gate

SDK 覆盖率必须达到项目设定阈值。

## S-GATE-070 Provider Catalog Alignment Gate

provider 名称与 runtime provider catalog 必须对齐。

执行命令：

- `pnpm check:live-provider-invariants`

## S-GATE-080 Live Smoke Gate

live smoke 在配置完整时必须可运行并给出可审计结果。

执行命令：

- `node scripts/run-live-test-matrix.mjs`
- `pnpm check:live-smoke-gate`

## S-GATE-090 Release Parity Gate

PR 与 release 的门禁策略保持同级，不允许 release 专属降级；SDK 包元数据/版本矩阵必须在发布前保持一致。

执行命令（release 前硬阻断）：

- `pnpm check:sdk-version-matrix`
- `pnpm check:live-smoke-gate --require-release`

## S-GATE-091 Docs Drift Gate

spec kernel consistency 与 docs drift 必须同时通过。

执行命令：

- `pnpm check:sdk-spec-kernel-consistency`
- `pnpm check:sdk-spec-kernel-docs-drift`

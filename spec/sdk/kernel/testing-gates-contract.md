# SDK Testing Gates Contract

> Owner Domain: `S-GATE-*`

## S-GATE-001 Layered Test Policy

SDK 门禁分层：单元/合同/边界/覆盖率/回归发布。

## S-GATE-010 Unit & Module Baseline

关键子路径必须有单元与模块级测试基线。

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

## S-GATE-080 Live Smoke Gate

live smoke 在配置完整时必须可运行并给出可审计结果。

## S-GATE-090 Release Parity Gate

PR 与 release 的门禁策略保持同级，不允许 release 专属降级。

## S-GATE-091 Docs Drift Gate

spec kernel consistency 与 docs drift 必须同时通过。

---
title: Nimi Runtime Proto Contract
status: FROZEN
created_at: 2026-02-24
updated_at: 2026-02-27
parent: INDEX.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Runtime wire schema source of truth is proto/runtime/v1/*.proto only.
  - This document defines governance and release gates only; it must not duplicate proto schema bodies.
---

# Runtime Proto Contract (Proto-First)

## 0. 文档定位

本文件是 runtime 协议治理合同，不是字段定义文件。

规范边界：
- 协议结构真相源：`proto/runtime/v1/*.proto`
- 平台语义与 L0 约束：`ssot/platform/protocol.md`
- 运行时执行语义：`ssot/runtime/service-contract.md`
- 本文职责：变更规则、兼容策略、发布门禁、AI Coding 执行顺序

## 1. 唯一真相源（Normative Source）

`MUST`：以下内容只能在 `.proto` 文件定义，不得在 SSOT 复制实体：
- service/rpc 名称与签名
- message/enum 定义
- 字段编号、oneof、reserved、option
- google/protobuf 依赖与 import 关系

目录冻结：
- `proto/runtime/v1/common.proto`
- `proto/runtime/v1/auth.proto`
- `proto/runtime/v1/grant.proto`
- `proto/runtime/v1/ai.proto`
- `proto/runtime/v1/workflow.proto`
- `proto/runtime/v1/model.proto`
- `proto/runtime/v1/knowledge.proto`
- `proto/runtime/v1/app.proto`
- `proto/runtime/v1/audit.proto`
- `proto/runtime/v1/local_runtime.proto`

## 2. SSOT 与 Proto 的职责分离

`MUST`：SSOT 只描述“为什么/约束是什么”，不描述“字段长什么样”。

允许写入 SSOT 的内容：
- 兼容策略（breaking/additive）
- 语义层约束（例如禁止静默 fallback）
- 变更流程与门禁命令
- 发布前验收标准

禁止写入 SSOT 的内容：
- 任何完整或半完整 proto 片段
- 任何可被复制粘贴成 `.proto` 的结构定义
- 用文档字段替代 `.proto` 字段的并行定义

## 3. 兼容性与演进规则

`MUST`：协议演进遵循 Buf 与语义版本双重约束。

规则：
1. breaking 变更必须通过 `proto:breaking` 并显式记录影响面。
2. additive 变更仍需通过 `proto:lint` 与 `proto:drift-check`。
3. 删除字段前必须先 `reserved` 字段号与字段名。
4. 新增 rpc 前必须在 `service-contract.md` 中补齐语义契约，再改 `.proto`。
5. SDK/runtime 生成代码不得手改，必须由 proto 生成链路产出。

## 4. 生成与校验链路

本仓协议流水线：
1. `pnpm proto:lint`
2. `pnpm proto:generate`
3. `pnpm proto:drift-check`
4. `go test ./...`（runtime）
5. `pnpm --filter @nimiplatform/sdk test`

产物约束：
- runtime 生成代码：`runtime/gen/runtime/v1/*`
- sdk 生成代码：`sdk/src/runtime/generated/runtime/v1/*`

`MUST`：生成产物与 `.proto` 保持零漂移。

## 5. AI Coding 执行顺序（Fail-Fast）

当 AI 或开发者需要改 runtime 协议时，执行顺序固定：
1. 修改 `proto/runtime/v1/*.proto`
2. 运行 `pnpm proto:lint && pnpm proto:generate && pnpm proto:drift-check`
3. 修正 runtime/sdk 编译与测试
4. 回写语义变化到 `service-contract.md` 或相关 SSOT（仅语义，不复制 schema）

`MUST NOT`：
- 先改 SDK/Runtime 生成代码再反推 proto
- 在 SSOT 中手写字段定义当作临时合同
- 通过注释或 wiki 维护第二份 wire schema

## 6. 发布门禁（Release Gates）

发布前必须满足：
- `pnpm proto:lint` 通过
- `pnpm proto:breaking` 通过
- `pnpm proto:generate` 后无未提交漂移
- `pnpm proto:drift-check` 通过
- runtime 与 sdk 对应测试通过

任一门禁失败：`NO-GO`。

## 7. 审计检查点

仓库规则检查必须覆盖：
- SSOT 不得嵌入 proto 实体定义
- 本文必须声明 `proto/runtime/v1/*.proto` 为唯一真相源
- 文档与 CI 命令一致

## 8. 变更记录

- `2026-02-26`：从“SSOT 内嵌 proto 草案”重构为“proto-first 治理合同”；移除并行 schema 定义。
- `2026-02-27`：R5 协议完整性收敛：扩展 canonical 多模态字段、`SubmitMediaJob` 幂等元数据、`WorkflowNode` 外部异步恢复语义与 `ModelCapabilityProfile`。

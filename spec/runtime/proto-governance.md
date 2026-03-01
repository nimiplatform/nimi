---
title: Proto Governance Domain Spec
status: ACTIVE
updated_at: 2026-03-01
---

# Proto Governance Domain Spec

> Status: Active
> Date: 2026-03-01
> Scope: Runtime 协议治理——变更规则、兼容策略、发布门禁、AI Coding 执行顺序。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

本文件不再重复定义跨域通用契约，统一导入 kernel 规则：

- RPC 面：`kernel/rpc-surface.md`（`K-RPC-*`）——服务与方法命名权威

## 1. 领域不变量

`PROTO-*` 为 Proto 治理领域增量规则（非 kernel 通用规则）。

- `PROTO-001`: `proto/runtime/v1/*.proto` 是 runtime wire schema 的唯一真相源。SSOT 与 spec 不得复制实体定义。
- `PROTO-002`: 生成产物（`runtime/gen/runtime/v1/*`、`sdk/src/runtime/generated/runtime/v1/*`）必须与 `.proto` 保持零漂移。
- `PROTO-003`: SDK/Runtime 生成代码不得手改，必须由 proto 生成链路产出。
- `PROTO-004`: 禁止 legacy 路径——不得先改 SDK/Runtime 生成代码再反推 proto，不得在 SSOT 中手写字段定义当作临时合同。

## 2. Proto 目录冻结

Proto 文件范围与 `K-RPC-001` 服务范围对应，目录固定为：

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

## 3. SSOT 与 Proto 职责分离

- `PROTO-010`: SSOT/spec 只描述"为什么/约束是什么"，不描述"字段长什么样"。
- `PROTO-011`: 允许写入 SSOT/spec 的内容：兼容策略、语义层约束、变更流程与门禁命令、发布前验收标准。
- `PROTO-012`: 禁止写入 SSOT/spec 的内容：完整或半完整 proto 片段、可被复制粘贴成 `.proto` 的结构定义。
- `PROTO-013`: 例外——`status=DRAFT` 设计稿可包含"NON-NORMATIVE"示意片段用于讨论方向，升格前必须移除。

## 4. 兼容性与演进规则

- `PROTO-020`: breaking 变更必须通过 `proto:breaking` 并显式记录影响面。
- `PROTO-021`: additive 变更仍需通过 `proto:lint` 与 `proto:drift-check`。
- `PROTO-022`: 删除字段前必须先 `reserved` 字段号与字段名。
- `PROTO-023`: 新增 RPC 前必须在对应 kernel 契约（`K-RPC-*`）中补齐语义契约，再改 `.proto`。
- `PROTO-024`: 命名权威以 `K-RPC-005`（design/proto 名称映射）为准，不得在 proto 层引入与 design 权威不一致的 RPC 名称。

## 5. 生成与校验链路

本仓协议流水线固定为：

1. `pnpm proto:lint`
2. `pnpm proto:generate`
3. `pnpm proto:drift-check`
4. `go test ./...`（runtime）
5. `pnpm --filter @nimiplatform/sdk test`

## 6. AI Coding 执行顺序（Fail-Fast）

当 AI 或开发者需要改 runtime 协议时，执行顺序固定：

1. 修改 `proto/runtime/v1/*.proto`
2. 运行 `pnpm proto:lint && pnpm proto:generate && pnpm proto:drift-check`
3. 修正 runtime/sdk 编译与测试
4. 回写语义变化到对应 kernel 契约（`K-RPC-*`）或相关 SSOT（仅语义，不复制 schema）

- `PROTO-030`: 禁止先改 SDK/Runtime 生成代码再反推 proto。
- `PROTO-031`: 禁止在 SSOT 中手写字段定义当作临时合同。
- `PROTO-032`: 禁止通过注释或 wiki 维护第二份 wire schema。

## 7. 发布门禁

发布前必须满足：

- `PROTO-040`: `pnpm proto:lint` 通过。
- `PROTO-041`: `pnpm proto:breaking` 通过。
- `PROTO-042`: `pnpm proto:generate` 后无未提交漂移。
- `PROTO-043`: `pnpm proto:drift-check` 通过。
- `PROTO-044`: runtime 与 sdk 对应测试通过。

任一门禁失败：`NO-GO`。

## 8. 本文件非目标

- 不定义 RPC 方法集合与字段契约（见 kernel `K-RPC-002` 至 `K-RPC-013`）
- 不定义 design/proto 名称映射表（见 kernel `K-RPC-005`）
- 不定义 proto 中的具体 message/enum 结构（见 `.proto` 文件本身）

## 9. 变更规则

修改 proto 治理规则时必须同时满足：

1. 若触及 RPC 面规则，先改 `spec/runtime/kernel/rpc-surface.md`
2. 再改本文件的领域增量规则
3. 禁止在本文件新增 kernel 规则副本

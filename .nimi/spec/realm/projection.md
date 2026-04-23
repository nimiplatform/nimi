---
id: SPEC-REALM-PROJECTION-001
title: Realm Projection Domain
status: active
owner: "@team"
updated: 2026-04-23
---

# Realm Projection Domain

## Normative Imports

- `kernel/projection-contract.md`: `R-PROJ-001..008`
- `kernel/truth-contract.md`: `R-TRUTH-001..014`
- `kernel/world-state-contract.md`: `R-WSTATE-001..006`

## Scope

Projection 定义 canonical truth 的正式消费层。它负责说明 truth 如何在不同
 consumer surface 上被解释、选择、约束与追踪，但它本身不是 truth write。

Projection 必须服务于：

- runtime consume path
- creator inspection path
- public read aggregates
- compat surfaces

当前仓内尚无独立 `/.nimi/spec/runtime/**` mounted authority，因此
`ProjectionInput / ProjectionRequest / ProjectionResult / ProjectionTraceRequirement`
的语义 owner 先收敛在 Realm Projection kernel。runtime 是这个 seam 的消费者，
不是当前阶段的 owner。

Projection 不能退化成：

- lorebook rebuild 的别名
- worldview preview 的别名
- prompt assembly helper 的别名

## Reading Path

1. `kernel/projection-contract.md`
2. `kernel/truth-contract.md`
3. `kernel/world-state-contract.md`
4. `kernel/tables/projection-contract.yaml`

## Non-goals

Projection does not own canonical truth, runtime execution policy, or app-local
consumer UX state.

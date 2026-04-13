---
id: SPEC-REALM-KERNEL-TRUTH-001
title: Realm Truth Kernel Contract
status: active
owner: "@team"
updated: 2026-04-09
---

# Truth Contract

> Domain: truth
> Rule family: R

## Scope

This contract defines the canonical truth layer for `nimi-realm`.

## R-TRUTH-001

Realm canonical truth is limited to creator-governed world truth and agent truth. Runtime story output is never truth by default.

## R-TRUTH-002

World truth must be anchored by `WorldRule` entries plus `WorldRelease` snapshots. `Worldview` and browse DTOs are computed projections, not truth.

## R-TRUTH-003

Agent truth must be anchored by `AgentRule` entries bound to a world scope. Agent truth defines identity and durable behavioral boundaries, not live prompt context.

## R-TRUTH-004

Truth writes are reserved for creator/control-plane authority. Apps may read truth but must not mutate truth through runtime story execution paths.

## R-TRUTH-005

Truth changes must be explicit, versioned, transactional, and auditable. A projection update must never masquerade as a truth write.

## R-TRUTH-006

Realm truth must remain app-independent. No single app, renderer, or model route may become the canonical owner of world or agent truth.

## R-TRUTH-007

`OASIS` is the unique system main world in Realm. It belongs to canonical world truth, cannot be creator-owned, and cannot be replaced by any creator world convention.

## R-TRUTH-008

`GET /api/world/oasis` is a formal Realm truth read surface for the system main world. It is not a legacy browse shortcut or app-local alias.

## R-TRUTH-009

Public read surfaces (e.g. `GET /api/world/by-id/{id}/detail-with-agents`) may expose computed aggregates derived from truth (`activeRuleCount`, `agentRuleSummary` byLayer) but must not expose AgentRule content. These aggregates are projection, not truth writes.

## R-TRUTH-010

`GET /api/world/by-id/{id}/scenes` is a public read surface exposing Scene identity (`id`, `name`, `description`, `activeEntities`) for a world. It does not modify truth state.

## R-TRUTH-011

官方内容工厂的 canonical truth write 必须收敛为单一 package-native publish contract。`world-drafts` 仍可作为 creator control-plane 的最小候选稿，但它们不是官方内容的长期 canonical publish contract，也不能与官方 package publish 并列为等价 truth-write 主线。

## R-TRUTH-012

官方 package publish 必须携带完整治理 provenance。至少要显式记录 official owner、editorial operator、reviewer、publisher，以及 source provenance / review verdict / publish actor；缺任一必填治理身份或治理结论时必须 fail-close，不能伪造“已审核”或“已发布”成功态。

## R-TRUTH-013

官方 package publish 必须原子写入 world truth、agent truth、projection inputs 与 `WorldRelease`。系统不得暴露“world 已发布但 agent truth 仍待后补”“truth 已写但 release 未冻结”这类中间态作为成功发布结果。

## R-TRUTH-014

`WorldRelease` 是官方 truth release governance 的唯一锚点。每次官方 publish 必须落一个显式 release identity，并绑定 package version、publish provenance、checksum / diff metadata 与 rollback lineage；rollback / supersede 必须通过 release 语义进行，不能通过 ad hoc truth rewrite 伪装完成。

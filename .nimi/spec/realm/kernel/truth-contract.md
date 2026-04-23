---
id: SPEC-REALM-KERNEL-TRUTH-001
title: Realm Truth Kernel Contract
status: active
owner: "@team"
updated: 2026-04-22
---

# Truth Contract

> Domain: truth
> Rule family: R

## Scope

This contract defines the canonical truth layer for `nimi-realm`.

Truth owns the canonical publish ingress for world and agent truth, the formal
world-to-agent derivation edge, and the governed boundary that upstream official
packages and creator entry paths must satisfy before any projection or runtime
consumer may act on them.

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

## R-TRUTH-015

`CanonicalTruthPackage` 是官方内容 publish 的正式上游 truth-ingress object。它必须显式区分 canonical truth units、derivation / inheritance inputs、projection inputs，以及 governance / release metadata。lorebook 文本、prompt payload、card view 等 consumer-shaped 文本不得成为 package 的 canonical semantic center。

## R-TRUTH-016

`InheritanceLink` 是 world truth 到 agent truth 的正式 derivation edge。它定义哪些 world truth 约束某个 agent truth scope、该 edge 如何在 host 层 materialize，以及哪些约束只保留为 derivation basis 而不是复制成 agent 文本。`WORLD_INHERITED` 与 `worldRuleRef` 可以作为这一 edge 的 materialization，但不能替代其完整语义。

## R-TRUTH-017

所有受治理的 agent entry path，包括官方 package publish、creator create-agent，以及 future import surface，都必须通过同一条 truth derivation line。若某入口无法产出受 truth governance 约束的 truth write、inheritance materialization 或 derivation basis，以及 projection inputs，则必须 fail-close，而不是生成旁路语义系统。

## R-TRUTH-018

Forge formal `extract-observations` 与 `refine-observations` 的 LLM wire contract
必须收敛为单一 `ObservationMarkupProtocol` 主线。受治理的 authoring artifacts
不得继续把 strict single-object JSON payload 视为正式 wire authority，也不得在
不同 provider 或不同 stage 之间分叉出并列 mainline。

## R-TRUTH-019

`ObservationCommitLedger` 的唯一合法 commit scope 是已闭合且已验证的
observation unit。截断 envelope、未闭合 unit、或仅通过 provider transport
返回但未通过 unit validation 的内容，不得伪装为已提交 authoring truth evidence。

## R-TRUTH-020

`ObservationContinuationPlan` 的语义 owner 是 runtime/authoring kernel，而不是
模型本身。模型可以声明 remaining categories 或 stop reason，但不得自定义 opaque
cursor、跳过已冻结 sequence discipline，或自行决定 committed artifact 与 final
consolidated batch 的边界。

## R-TRUTH-021

官方 publish、workspace continuation、以及任何受治理的 Forge commit surface，
都必须显式区分 raw attempt artifacts、committed observation units、以及 final
consolidated extraction batch。raw provider output、partial attempt residue、
或未完成 continuation 的中间态，不得直接作为 canonical truth ingress 或 publish
evidence 成功态。

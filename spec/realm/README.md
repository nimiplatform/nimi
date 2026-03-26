---
id: SPEC-REALM-README-001
title: Realm Spec
status: active
owner: "@team"
updated: 2026-03-26
---

# Realm Spec

Realm spec follows: `Rule -> Table -> Generate -> Check -> Evidence`.

Realm hard-cut core is `Truth / World State / World History / Agent Memory`, with `OASIS` formalized as the unique system main world anchor and `Chat` retained only as `HUMAN_HUMAN + DIRECT`.

`world-drafts` are part of the creator control-plane only as minimal publish candidates. Editor/runtime workflow state remains Forge-local.

## Structure

- Contracts: `kernel/*.md`
- Tables: `kernel/tables/*.yaml`
- Authorization matrix: `kernel/tables/commit-authorization-matrix.yaml`
- Object lifecycle authorization facts: `kernel/tables/object-write-authorization.yaml`
- Generated: `kernel/generated/*.md`
- Domain docs (thin): `truth.md`, `world-state.md`, `world-history.md`, `agent-memory.md`, `world.md`, `agent.md`, `chat.md`, `social.md`, `economy.md`, `asset.md`, `transit.md`
- Bridge docs (thin): `app-interconnect-model.md`, `world-creator-economy.md`, `creator-revenue-policy.md`, `realm-interop-mapping.md`

## Rule ID Format

- `R-TRUTH-NNN`
- `R-WSTATE-NNN`
- `R-WHIST-NNN`
- `R-MEM-NNN`
- `R-CHAT-NNN`
- `R-RSRC-NNN`
- `R-ATTACH-NNN`
- `R-SOC-NNN`
- `R-ECON-NNN`
- `R-ASSET-NNN`
- `R-BNDL-NNN`
- `R-TRANSIT-NNN`

`R-BIND-*` 当前不在本仓规范内反推。相关 binding contract / enums / 对齐映射必须等待上游权威正文后再一次性同步；在此之前只记录阻塞状态，不造新规则。

## Language Convention

Bilingual (Chinese + English) is an intentional design choice:

- `rule_id` is the cross-language canonical key (always English, e.g. `R-TRUTH-001`)
- `rule-catalog.yaml`: Chinese title/statement (human-facing summary)
- Contract YAMLs: English title/statement (machine-facing canonical)
- Contract MDs: Chinese prose (human spec narrative)

When in doubt, `rule_id` is the single source of truth for cross-referencing.

## Commands

```bash
pnpm spec:realm:generate
pnpm spec:realm:check:consistency
pnpm spec:realm:check:drift
pnpm spec:realm:check:nimi-alignment
pnpm spec:realm:gate
```

---
id: SPEC-REALM-README-001
title: Realm Spec
status: active
owner: "@team"
updated: 2026-03-26
---

# Realm Spec

Realm spec follows: `Rule -> Table -> Generate -> Check -> Evidence`.

Realm hard-cut semantic core is `Truth / World State / World History / Agent Memory / Chat`, with `OASIS` formalized as the unique system main world anchor. `Social / Economy / Resource / Attachment / Binding / Asset / Bundle / Transit` remain adjacent formal domains.

`world-drafts` are part of the creator control-plane only as minimal publish candidates. Editor/runtime workflow state remains Forge-local. Official content factory publish is package-native and must not create a parallel long-term truth-write contract beside the canonical package line.

## Structure

- Contracts: `kernel/*.md`
- Tables: `kernel/tables/*.yaml`
- Authorization matrix: `kernel/tables/commit-authorization-matrix.yaml`
- Generated: `kernel/generated/*.md`
- Domain docs (thin): `truth.md`, `world-state.md`, `world-history.md`, `agent-memory.md`, `world.md`, `agent.md`, `binding.md`, `chat.md`, `social.md`, `economy.md`, `asset.md`, `transit.md`
- Bridge docs (thin): `app-interconnect-model.md`, `world-creator-economy.md`, `creator-revenue-policy.md`, `realm-interop-mapping.md`

## Rule ID Format

- `R-TRUTH-NNN`
- `R-WSTATE-NNN`
- `R-WHIST-NNN`
- `R-MEM-NNN`
- `R-RSRC-NNN`
- `R-ATTACH-NNN`
- `R-BIND-NNN`
- `R-CHAT-NNN`
- `R-SOC-NNN`
- `R-ECON-NNN`
- `R-ASSET-NNN`
- `R-BNDL-NNN`
- `R-TRANSIT-NNN`

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

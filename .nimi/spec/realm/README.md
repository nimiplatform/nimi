---
id: SPEC-REALM-README-001
title: Realm Spec
status: active
owner: "@team"
updated: 2026-04-18
---

# Realm Spec

Realm spec follows: `Rule -> Table -> Generate -> Check -> Evidence`.

Realm hard-cut semantic core is `Truth / Projection / World State / World History / Chat`, with `OASIS` formalized as the unique system main world anchor. `Social / Economy / Resource / Attachment / Binding / Asset / Bundle / Transit` remain adjacent formal domains.

`world-drafts` are part of the creator control-plane only as minimal publish candidates. Editor/runtime workflow state remains Forge-local. Official content factory publish is package-native and must not create a parallel long-term truth-write contract beside the canonical package line.

## Structure

- Contracts: `kernel/*.md`
- Tables: `kernel/tables/*.yaml`
- Authorization matrix: `kernel/tables/commit-authorization-matrix.yaml`
- Generated: `kernel/generated/*.md`
- Domain docs (thin): `truth.md`, `projection.md`, `world-state.md`, `world-history.md`, `world.md`, `agent.md`, `binding.md`, `chat.md`, `social.md`, `economy.md`, `asset.md`, `transit.md`
- Bridge docs (thin): `app-interconnect-model.md`, `world-creator-economy.md`, `creator-revenue-policy.md`, `realm-interop-mapping.md`

## Rule ID Format

- `R-TRUTH-NNN`
- `R-PROJ-NNN`
- `R-WSTATE-NNN`
- `R-WHIST-NNN`
- `R-RSRC-NNN`
- `R-ATTACH-NNN`
- `R-BIND-NNN`
- `R-CHAT-NNN`
- `R-SOC-NNN`
- `R-ECON-NNN`
- `R-ASSET-NNN`
- `R-BNDL-NNN`
- `R-TRANSIT-NNN`

## Rule Catalog Authority

Realm rule semantic authority is single-source:

- Contract markdown plus contract tables are the only Realm rule semantic source.
- `rule_id` is the cross-language canonical key (always English, e.g. `R-TRUTH-001`).
- Contract YAMLs provide canonical machine-facing `title` and `statement`.
- Contract MDs provide human spec narrative.
- `rule-catalog.yaml` is a generated derivative index. Its `statement` field must
  exactly match the corresponding contract table statement and must not be edited
  as a separate summary.

If bilingual human summaries are needed later, they must be added to contract
tables as explicit derived fields such as `human_summary_zh`, then generated into
catalog views. They must not be hand-authored only in `rule-catalog.yaml`.

## Commands

```bash
pnpm spec:realm:generate
pnpm spec:realm:check:consistency
pnpm spec:realm:check:drift
pnpm spec:realm:check:nimi-alignment
pnpm spec:realm:gate
```

---
title: Nimi SSOT Index
status: ACTIVE
updated_at: 2026-02-25
rules:
  - `@nimiplatform/nimi` 的 `ssot/` 是开源平台主仓唯一真相目录，覆盖 runtime/sdk/desktop/mod/platform/economy；业务 mod SSOT 由 `@nimiplatform/nimi-mods/<mod>/SSOT.md` 自维护。
  - 每篇 SSOT 必须有 frontmatter 与 rules 列表，并在 traceability 矩阵登记。
  - 变更流程固定为：先改 SSOT，再改实现与示例。
---

# Nimi SSOT

This directory is the public SSOT root in `@nimiplatform/nimi`.

## Domains

- `platform/` — protocol, architecture, migration, vision, open-source governance
- `runtime/` — service contract, proto contract, DAG workflow, local runtime, providers
- `sdk/` — SDK design contract
- `desktop/` — desktop runtime contract and runtime-first application contract
- `mod/` — mod governance and mod codegen contract
- `economy/` — creator economy, revenue policy, realm interop mapping
- `boundaries/` — closed-source realm domain boundary stubs (world/agent/social)

Per-mod business SSOT is owned by `@nimiplatform/nimi-mods` in each mod directory (`<mod>/SSOT.md`).

## Authoring Rules

1. Keep `reasonCode + actionHint` semantics explicit for failure paths.
2. Include acceptance gates and testability criteria.
3. Use no-legacy policy unless external dependency blocks final state.
4. Keep cross-doc references within `ssot/*` as canonical links.

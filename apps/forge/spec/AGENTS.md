# Forge Spec — AGENTS.md

> Editing rules for all AI agents working on Forge spec documents.

## Authoritative Structure

```
spec/
├── AGENTS.md                           # This file — editing rules
├── forge.md                            # Top-level product spec (positioning / tech stack / architecture)
├── kernel/
│   ├── app-shell-contract.md           # FG-SHELL-*: App Shell + Bootstrap + Auth
│   ├── world-migration-contract.md     # FG-WORLD-*: World management migration contract
│   ├── agent-management-contract.md    # FG-AGENT-*: Agent management contract
│   ├── content-creation-contract.md    # FG-CONTENT-*: AI content creation contract
│   ├── copyright-contract.md           # FG-IP-*: Copyright management contract
│   ├── revenue-contract.md             # FG-REV-*: Revenue statistics contract
│   ├── template-market-contract.md     # FG-TPL-*: Template marketplace contract
│   ├── ai-advisor-contract.md          # FG-ADV-*: AI advisor contract
│   ├── analytics-contract.md           # FG-ANA-*: Analytics contract
│   ├── import-contract.md              # FG-IMPORT-*: Import pipelines contract
│   └── tables/
│       ├── routes.yaml                 # Route table — authoritative
│       ├── api-surface.yaml            # API surface — existing + new endpoints
│       └── feature-matrix.yaml         # Feature matrix — phase / priority / dependencies
└── execution-plan.md                   # Phased execution plan + milestones
```

## Rule ID Format

All rules use prefix `FG-<DOMAIN>-NNN`.

| Domain | Prefix | Contract |
|--------|--------|----------|
| Shell / Bootstrap / Auth | FG-SHELL | `app-shell-contract.md` |
| World Management | FG-WORLD | `world-migration-contract.md` |
| Agent Management | FG-AGENT | `agent-management-contract.md` |
| Content Creation | FG-CONTENT | `content-creation-contract.md` |
| Copyright / IP | FG-IP | `copyright-contract.md` |
| Revenue | FG-REV | `revenue-contract.md` |
| Template Market | FG-TPL | `template-market-contract.md` |
| AI Advisor | FG-ADV | `ai-advisor-contract.md` |
| Analytics | FG-ANA | `analytics-contract.md` |
| Import | FG-IMPORT | `import-contract.md` |

## Fact Sources

YAML tables in `kernel/tables/` are the authoritative fact sources. Prose in contract `.md` files references but does not duplicate table data.

| File | Content |
|------|---------|
| `routes.yaml` | All route definitions (path, feature, component, lazy loading) |
| `api-surface.yaml` | API endpoint inventory (method, path, status, feature binding) |
| `feature-matrix.yaml` | Feature matrix (phase, priority, backend dependency, migration source) |

## Editing Rules

1. **No contract may contradict a YAML table.** If a prose rule and a table row disagree, the table wins.
2. **Rule IDs are append-only.** Never renumber or reuse a retired rule ID.
3. **Cross-references use rule IDs**, not section headings (e.g., "per FG-SHELL-003" not "see Bootstrap section").
4. **Tables are the single source for enumerations.** Do not inline route lists, API lists, or feature lists in prose contracts.
5. **World-Studio spec alignment.** Where Forge inherits behavior from World-Studio, reference `WS-*` rule IDs from `nimi-mods/runtime/world-studio/spec/kernel/`.
6. **New backend API proposals** must include: HTTP method, path, request/response shape sketch, and target controller module.

## Relation to World-Studio Spec

Forge migrates World-Studio mod functionality into a standalone Tauri app. The following World-Studio contracts are inherited by reference:

- `WS-PIPE-*` — Pipeline contract (CREATE step chain, MAINTAIN operations)
- `WS-TASK-*` — Task lifecycle (single-flight execution, checkpoint, pause/resume)
- `WS-QG-*` — Quality gate contract
- `WS-CONFLICT-*` — Conflict recovery
- `WS-ERR-*` — Error model

Forge contracts extend or override these where the standalone app context diverges from the mod context.

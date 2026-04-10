# ShiJi Spec — AGENTS.md

> Editing rules for all AI agents working on ShiJi spec documents.

## Authoritative Structure

```
spec/
├── AGENTS.md                           # This file — editing rules
├── INDEX.md                            # Reading path and fact sources
├── shiji.md                            # Top-level product spec (positioning / content scope / architecture)
├── kernel/
│   ├── app-shell-contract.md           # SJ-SHELL-*: App Shell + Bootstrap + Auth
│   ├── explore-contract.md             # SJ-EXPL-*: World/Agent browsing and selection
│   ├── map-contract.md                 # SJ-MAP-*: Historical map surface
│   ├── dialogue-contract.md            # SJ-DIAL-*: Dialogue engine pipeline
│   ├── knowledge-contract.md           # SJ-KNOW-*: Knowledge scaffolding and tracking
│   ├── progress-contract.md            # SJ-PROG-*: Learning progress and achievements
│   └── tables/
│       ├── routes.yaml                 # Route table — authoritative
│       ├── api-surface.yaml            # Consumed Realm API endpoints
│       ├── feature-matrix.yaml         # Feature matrix — phase / priority / dependencies
│       ├── world-catalog.yaml          # White-listed worlds for ShiJi
│       ├── content-classification.yaml # Content type + truth-mode enums
│       ├── map-surface.yaml            # Map profile shape for atlas view
│       └── local-storage.yaml          # Local SQLite schema for learner data
└── (no execution-plan.md — local execution plans belong in nimi-coding/.local/**)
```

## Rule ID Format

All rules use prefix `SJ-<DOMAIN>-NNN`.

| Domain | Prefix | Contract |
|--------|--------|----------|
| Shell / Bootstrap / Auth | SJ-SHELL | `app-shell-contract.md` |
| Explore / Browse | SJ-EXPL | `explore-contract.md` |
| Map / Spatial Explore | SJ-MAP | `map-contract.md` |
| Dialogue Engine | SJ-DIAL | `dialogue-contract.md` |
| Knowledge System | SJ-KNOW | `knowledge-contract.md` |
| Progress / Achievements | SJ-PROG | `progress-contract.md` |

## Fact Sources

YAML tables in `kernel/tables/` are the authoritative fact sources. Prose in contract `.md` files references but does not duplicate table data.

| File | Content |
|------|---------|
| `routes.yaml` | All route definitions (path, feature, component, lazy loading) |
| `api-surface.yaml` | Consumed Realm API endpoints (method, path, status, feature binding) |
| `feature-matrix.yaml` | Feature matrix (phase, priority, dependencies) |
| `world-catalog.yaml` | ShiJi world whitelist, display order, content metadata |
| `content-classification.yaml` | Content type / truth-mode enum pairs and display labels |
| `map-surface.yaml` | Historical map profile shape for world atlas |
| `local-storage.yaml` | Local SQLite tables used by ShiJi learning records |

## Editing Rules

1. **No contract may contradict a YAML table.** If a prose rule and a table row disagree, the table wins.
2. **Rule IDs are append-only.** Never renumber or reuse a retired rule ID.
3. **Cross-references use rule IDs**, not section headings (e.g., "per SJ-DIAL-003" not "see Dialogue section").
4. **Tables are the single source for enumerations.** Do not inline route lists, API lists, feature lists, content taxonomy enums, or world-catalog membership in prose contracts.
5. **Realm API consumption only.** ShiJi stable behavior consumes existing World/Agent/Lorebook APIs only. Spec may register `status: proposed` read surfaces in `api-surface.yaml` as backend proposals, but proposed surfaces are not approved implementations and must not be treated as already available.
6. **World eligibility lives in `world-catalog.yaml`.** No prose contract may treat tags, search results, or ad hoc metadata as the authoritative browse whitelist.
7. **Local storage references require table docs.** Any SQLite table named in prose contracts must have a matching authoritative entry in `kernel/tables/local-storage.yaml`.

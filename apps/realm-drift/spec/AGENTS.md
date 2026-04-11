# Realm Drift Spec — AGENTS.md

> Editing rules for all AI agents working on Realm Drift spec documents.

## Authoritative Structure

```
spec/
├── AGENTS.md                              # This file — editing rules
├── realm-drift.md                         # App-level product overview (positioning, tech stack, comparison)
├── kernel/
│   ├── app-shell-contract.md              # RD-SHELL-*: App Shell + Bootstrap + Auth + Layout
│   ├── world-exploration-contract.md      # RD-EXPLORE-*: World browser, viewer, 3D embedding
│   ├── marble-integration-contract.md     # RD-MARBLE-*: World Labs Marble API integration
│   ├── agent-chat-contract.md             # RD-CHAT-*: Agent selection + Runtime SDK streaming chat
│   ├── human-chat-contract.md             # RD-HCHAT-*: Cross-app human chat via Realm + Socket.IO
│   └── tables/
│       ├── routes.yaml                    # Route table — authoritative
│       ├── feature-matrix.yaml            # Feature matrix — phase / priority / dependencies
│       └── external-api-surface.yaml      # World Labs Marble API surface — endpoints / costs
```

Implementation plans live outside the spec tree:
- `.local/work/<topic-id>/**` — local phased implementation guides and execution evidence (non-normative)

## Rule ID Format

All rules use prefix `RD-<DOMAIN>-NNN`.

| Domain | Prefix | Contract |
|--------|--------|----------|
| Shell / Bootstrap / Auth / Layout | RD-SHELL | `app-shell-contract.md` |
| World Browser / Viewer / 3D Embedding | RD-EXPLORE | `world-exploration-contract.md` |
| Marble API / Prompt / Polling / Provider Abstraction | RD-MARBLE | `marble-integration-contract.md` |
| Agent Chat / Streaming / Session | RD-CHAT | `agent-chat-contract.md` |
| Human Chat / Realtime / Cross-App | RD-HCHAT | `human-chat-contract.md` |

## Fact Sources

YAML tables in `kernel/tables/` are the authoritative fact sources. Prose in contract `.md` files references but does not duplicate table data.

| File | Content |
|------|---------|
| `routes.yaml` | All route definitions (path, feature, component, lazy loading) |
| `feature-matrix.yaml` | Feature matrix (phase, priority, backend dependency, external dependency) |
| `external-api-surface.yaml` | World Labs Marble API endpoint inventory (method, path, input, output, cost) |

## Editing Rules

1. **No contract may contradict a YAML table.** If a prose rule and a table row disagree, the table wins.
2. **Rule IDs are append-only.** Never renumber or reuse a retired rule ID.
3. **Cross-references use rule IDs**, not section headings (e.g., "per RD-SHELL-003" not "see Bootstrap section").
4. **Tables are the single source for enumerations.** Do not inline route lists, API endpoint lists, or feature lists in prose contracts.
5. **External API specs track upstream.** When the World Labs Marble API changes, update `external-api-surface.yaml` first, then adjust affected contract rules.
6. **Forge spec alignment.** Where Realm Drift inherits behavior from Forge, reference `FG-*` rule IDs from `apps/forge/spec/kernel/`.

## Relation to Forge Spec

Realm Drift reuses the Forge app shell pattern (Tauri + SDK direct connectivity). The following Forge contracts are inherited by reference:

- `FG-SHELL-001` through `FG-SHELL-010` — App shell baseline (trimmed for Realm Drift)
- `FG-SHELL-003` — Bootstrap sequence (simplified from 7-step to 5-step)

Realm Drift contracts extend or override these where the demo app context diverges from the creator studio context.

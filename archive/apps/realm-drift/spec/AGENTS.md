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

Implementation plans and human-authored topic reports live outside the spec tree:
- `.nimi/topics/{proposal|ongoing|pending|closed}/<topic-id>/**` — local phased design, packet, and closeout material (non-normative)

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
| `runtime-account-caller.yaml` | Realm Drift RuntimeAccountService caller identity (RD-SHELL-009) |

## Editing Rules

1. **No contract may contradict a YAML table.** If a prose rule and a table row disagree, the table wins.
2. **Rule IDs are append-only.** Never renumber or reuse a retired rule ID.
3. **Cross-references use rule IDs**, not section headings (e.g., "per RD-SHELL-003" not "see Bootstrap section").
4. **Tables are the single source for enumerations.** Do not inline route lists, API endpoint lists, or feature lists in prose contracts.
5. **External API specs track upstream.** When the World Labs Marble API changes, update `external-api-surface.yaml` first, then adjust affected contract rules.
6. **No archived-app inheritance.** Realm Drift must keep its contracts local or reference platform kernel rules; archived app specs are not active authority.

## Relation to App Shell Patterns

Realm Drift uses the platform app-shell pattern (Tauri + SDK direct
connectivity). Realm Drift contracts are self-contained and do not inherit
archived app specs by reference.

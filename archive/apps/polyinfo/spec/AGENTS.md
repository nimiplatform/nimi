# Polyinfo Spec — AGENTS.md

> Editing rules for all AI agents working on Polyinfo spec documents.

## Authoritative Structure

```text
spec/
├── AGENTS.md                              # This file — editing rules
├── polyinfo.md                            # App-level product overview
├── kernel/
│   ├── app-shell-contract.md              # PI-SHELL-*: shell, bootstrap, routing, layout
│   ├── taxonomy-contract.md               # PI-TAX-*: sector, narrative, core variable, custom-sector import workflow
│   ├── market-data-contract.md            # PI-DATA-*: Polymarket discovery, history, realtime ingest
│   ├── signal-contract.md                 # PI-SIGNAL-*: analysis input, weighting, LLM-run output
│   ├── discussion-contract.md             # PI-DISCUSS-*: sector analyst session and manual confirmation
│   └── tables/
│       ├── routes.yaml                    # Route table — authoritative
│       ├── feature-matrix.yaml            # Feature matrix — authoritative
│       ├── object-model.yaml              # Current active objects and invariants
│       ├── external-api-surface.yaml      # Upstream Polymarket surface inventory
│       └── signal-model.yaml              # Window, weighting, and signal output inventory
```

## Rule ID Format

All rules use prefix `PI-<DOMAIN>-NNN`.

| Domain | Prefix | Contract |
|--------|--------|----------|
| Shell / Bootstrap / Routing / Layout | PI-SHELL | `app-shell-contract.md` |
| Sector / Narrative / Core Variable / Custom Import | PI-TAX | `taxonomy-contract.md` |
| Market Discovery / History / Realtime / Price Semantics | PI-DATA | `market-data-contract.md` |
| Analysis Input / Weighting / Output | PI-SIGNAL | `signal-contract.md` |
| Sector Analyst Session / Agent Proposal / Confirmation | PI-DISCUSS | `discussion-contract.md` |

## Fact Sources

YAML tables in `kernel/tables/` are the authoritative fact sources. Prose in contract `.md` files references but does not duplicate table data.

| File | Content |
|------|---------|
| `routes.yaml` | All route definitions |
| `feature-matrix.yaml` | Feature phasing, priority, and dependencies |
| `object-model.yaml` | Active objects, enums, relationships, invariants |
| `external-api-surface.yaml` | Polymarket discovery, history, and realtime API inventory |
| `signal-model.yaml` | Time windows, weighting factors, and output types |

## Editing Rules

1. **No contract may contradict a YAML table.** If prose and a table disagree, the table wins.
2. **Rule IDs are append-only.** Never renumber or reuse a retired rule ID.
3. **Cross-references use rule IDs**, not section headings.
4. **Tables are the single source for enumerations.** Do not inline route lists, object enums, window enums, or source endpoint lists in prose.
5. **Polymarket is an upstream market data source, not app authority.** Polyinfo may inherit sector source and market facts from Polymarket, but it owns its own narrative, core-variable, and signal semantics.
6. **No news truth promotion.** News, social posts, and manual commentary must not become canonical signal inputs in this spec tree.
7. **Manual confirmation remains authoritative.** Agent proposals for narratives or core variables remain drafts until a user confirms them.
8. **Realm truth boundary is inherited, not redefined.** Polyinfo may use runtime chat or app-local discussion surfaces, but it must not redefine Realm chat or agent authority.

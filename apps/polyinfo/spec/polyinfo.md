# Polyinfo — Top-Level Product Spec

> Status: Draft | Date: 2026-04-23

## Authority Preflight

- Spec Status: Draft
- Authority Owner: `apps/polyinfo/spec/**`
- Work Type: redesign
- Parallel Truth: none; this spec tree is the sole app authority for Polyinfo semantics

## Product Positioning

Polyinfo is a standalone market-analysis application in the nimi ecosystem.

Its purpose is to turn Polymarket market movement into a clean, chat-first analytical workspace without using news as canonical input.

Polyinfo provides:

- **Official Sector Workspaces** — open a sector sourced from Polymarket's front-end category structure, with top-level category selection and concrete sector selection separated in the shell
- **Custom Sector Workspaces** — create an app-local sector and import chosen events by Polymarket URL
- **Narrative Curation** — maintain sector-local narrative buckets with the analyst during chat or direct editing
- **Core Issue Tracking** — maintain sector-local core issues that express the main analytical questions a user wants to follow
- **Sector Analyst Sessions** — open any sector and immediately talk with an app-local analyst agent that already knows that sector's current structure and event evidence
- **Structured Analysis Runs** — feed current event movement, weighting facts, narratives, and core issues into the analyst agent so it produces the current analytical conclusion
- **Discussion Surface** — let a user debate conclusions with the analyst agent and revise sector structure inside the same chat flow

Polyinfo is not a trading client and not a news product.

## Core Boundary

Polyinfo does **not** redefine:

- Polymarket market structure or exchange semantics
- Realm chat authority
- Realm agent authority
- runtime-owned canonical agent memory

Polyinfo consumes upstream market data and creates app-local analytical objects layered above that data:

- `Sector`
- `Narrative`
- `CoreVariable`
- `ImportedEvent`
- `SignalSnapshot`
- `DiscussionThread`

## Primary User

The primary user is an analyst who wants to:

- monitor one official or custom sector
- watch how multiple related events move across a chosen time window
- ask for a fresh analytical read as soon as they open the sector
- debate the interpretation with a sector-local analyst agent
- revise narratives and core issues during the same conversation
- preserve app-local analytical structure without mixing in news

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2.10 |
| Frontend | React 19 + Vite 7 + Tailwind 4 |
| State management | Zustand |
| Data fetching | TanStack Query |
| SDK | `@nimiplatform/sdk/runtime` |
| Kit core | `@nimiplatform/nimi-kit/core/*` |
| Chat shell | `@nimiplatform/nimi-kit/features/chat/*` (runtime/app-local surface only) |
| External market data | Polymarket Gamma API + market WebSocket + price history APIs |

Polyinfo follows the SDK-first shell pattern used by other standalone nimi apps:

- **Platform client** — `createPlatformClient({ appId: 'nimi.polyinfo', runtimeTransport: 'tauri-ipc', sessionStore })`
- **Runtime** — consumed from the returned SDK client for sector analyst sessions and analysis runs

## External Dependencies

| Dependency | Provider | Type | Purpose |
|-----------|----------|------|---------|
| Gamma API | Polymarket | REST API | Official sector discovery, event detail, custom-sector validation |
| Market WebSocket | Polymarket | WebSocket | Realtime market updates |
| Price History API | Polymarket | REST API | Arbitrary historical windows for signal calculation |

Detailed inventory lives in `kernel/tables/external-api-surface.yaml`.

## Project Location

```text
nimi/apps/polyinfo/
├── spec/                        # This spec tree
└── src/                         # Current implementation
```

## Workspace Integration

- Package name: `@nimiplatform/polyinfo`
- Workspace: `nimi/` pnpm workspace, pattern `apps/*`
- Dev port: `1426`
- Tauri identifier: `world.nimi.polyinfo`

## Navigation Structure

All routes are defined in `kernel/tables/routes.yaml`.

Primary product flow:

- `/` restores the most recent sector workspace when possible
- `/sectors/:sectorId` is the main working surface

Secondary pages:

- `Signals`
- `Runtime`
- `Settings`

There is no dashboard-first home and no mapping page in the active product flow.

## Object Model Summary

Current active objects and invariants are authoritative in `kernel/tables/object-model.yaml`.

High-level relationship:

- `Sector` is the top-level analytical workspace and may be official or custom
- `Narrative` is a sector-local market-clustering object
- `CoreVariable` is a sector-local analytical question
- `ImportedEvent` is a custom-sector cache of upstream event metadata
- `SignalSnapshot` records one analysis run output for a chosen time window
- `DiscussionThread` records sector-local analyst interaction tied to a sector and optional snapshot context

## Normative Imports

This spec imports the following kernel contracts:

| Contract | Rule prefix | Scope |
|----------|-------------|-------|
| `kernel/app-shell-contract.md` | PI-SHELL-* | shell, bootstrap, navigation, persistence |
| `kernel/taxonomy-contract.md` | PI-TAX-* | sector, narrative, core variable, custom-sector import semantics |
| `kernel/market-data-contract.md` | PI-DATA-* | Polymarket discovery, history, realtime ingest, price semantics |
| `kernel/signal-contract.md` | PI-SIGNAL-* | analysis input package, weighting, output |
| `kernel/discussion-contract.md` | PI-DISCUSS-* | sector analyst sessions, user-agent discussion, and manual confirmation |

## Non-Goals

- Polyinfo does not place trades
- Polyinfo does not ingest or rank news
- Polyinfo does not promote app-local discussion into Realm truth
- Polyinfo does not auto-confirm narratives or core variables without user action
- Polyinfo does not persist event-to-narrative or event-to-core-issue mappings as long-term product objects
- Polyinfo does not treat every market equally; low-liquidity and low-volume markets remain visible but are downweighted

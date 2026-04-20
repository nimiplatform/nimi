# Polyinfo — Top-Level Product Spec

> Status: Draft | Date: 2026-04-20

## Authority Preflight

- Spec Status: Draft
- Authority Owner: `apps/polyinfo/spec/**`
- Work Type: redesign
- Parallel Truth: none; this spec tree is the sole app authority for Polyinfo semantics

## Product Positioning

Polyinfo is a standalone market-analysis application in the nimi ecosystem.

Its purpose is to transform Polymarket market movement into structured, debate-ready signal analysis without using news as an input source.

Polyinfo provides:

- **Sector Monitoring** — organize markets by upstream Polymarket sector source in v1
- **Narrative Curation** — maintain sector-local narrative buckets that cluster related markets
- **Core Variable Tracking** — maintain sector-local core variables that express the main analytical questions a user wants to follow
- **Realtime Dashboarding** — combine discovery snapshots, historical windows, and realtime market updates
- **Sector Analyst Sessions** — open any sector and immediately talk with an app-local analyst agent that already knows that sector's current taxonomy and market state
- **Structured Analysis Runs** — feed structured market movement, weighting facts, narratives, and core variables into the analyst agent so it produces the current analytical conclusion
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
- `TrackedMarket`
- `SignalSnapshot`
- `DiscussionThread`

## Primary User

The primary user is an analyst who wants to:

- monitor one sector such as Iran
- watch how multiple related markets move across a chosen time window
- ask for a fresh analytical read as soon as they open the sector
- debate the interpretation with a sector-local analyst agent
- revise narratives and core variables during the same conversation
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
| Gamma API | Polymarket | REST API | Market and event discovery, tags, event detail |
| Market WebSocket | Polymarket | WebSocket | Realtime market updates |
| Price History API | Polymarket | REST API | Arbitrary historical windows for signal calculation |

Detailed inventory lives in `kernel/tables/external-api-surface.yaml`.

## Project Location

```text
nimi/apps/polyinfo/
├── spec/                        # This spec tree
└── (implementation deferred)
```

## Workspace Integration

- Package name: reserved for future implementation as `@nimiplatform/polyinfo`
- Workspace: `nimi/` pnpm workspace, pattern `apps/*`
- Dev port: reserved for future implementation
- Tauri identifier: reserved for future implementation

## Navigation Structure

All routes are defined in `kernel/tables/routes.yaml`.

Primary navigation:

- `Dashboard`
- `Sectors`
- `Signals`
- `Settings`

`Dashboard` is the default home and primary product surface, but every sector workspace is a first-class analysis entrypoint.

## Object Model Summary

Current active objects and invariants are authoritative in `kernel/tables/object-model.yaml`.

High-level relationship:

- `Sector` is the top-level analytical workspace
- `Narrative` is a sector-local market-clustering object
- `CoreVariable` is a sector-local analytical question
- `TrackedMarket` binds upstream market facts into sector-local analysis
- `SignalSnapshot` records one analysis run output for a chosen time window
- `DiscussionThread` records sector-local analyst interaction tied to a sector, narrative, or core variable

## Normative Imports

This spec imports the following kernel contracts:

| Contract | Rule prefix | Scope |
|----------|-------------|-------|
| `kernel/app-shell-contract.md` | PI-SHELL-* | shell, bootstrap, navigation, persistence |
| `kernel/taxonomy-contract.md` | PI-TAX-* | sector, narrative, core variable, market mapping |
| `kernel/market-data-contract.md` | PI-DATA-* | Polymarket discovery, history, realtime ingest, price semantics |
| `kernel/signal-contract.md` | PI-SIGNAL-* | analysis input package, weighting, output |
| `kernel/discussion-contract.md` | PI-DISCUSS-* | sector analyst sessions, user-agent discussion, and manual confirmation |

## Non-Goals

- Polyinfo does not place trades
- Polyinfo does not ingest or rank news
- Polyinfo does not promote app-local discussion into Realm truth
- Polyinfo does not auto-confirm narratives or core variables without user action
- Polyinfo does not treat every market equally; low-liquidity and low-volume markets remain visible but are downweighted

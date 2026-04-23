# Polyinfo — Top-Level Product Spec

> Status: Current App-Aligned Draft | Date: 2026-04-24

## Authority Preflight

- Spec Status: Draft
- Authority Owner: `apps/polyinfo/spec/**`
- Work Type: alignment
- Parallel Truth: none; this spec tree describes the current shipped app behavior and is the sole app authority for Polyinfo semantics

## Product Positioning

Polyinfo is a standalone market-analysis application in the nimi ecosystem.

Its current role is to turn Polymarket sector movement into a manual, chat-assisted analytical workspace without using news as canonical input.

Polyinfo currently provides:

- **Official Sector Browsing** — browse official sectors sourced from Polymarket's front-end category structure, with root-category selection in the top bar and concrete sector selection in the left rail
- **Custom Sector Workspaces** — create an app-local sector and import chosen events by Polymarket URL
- **Sector-Local Taxonomy Editing** — maintain narratives and core issues for each sector through direct panel editing or analyst proposals
- **Manual Price Loading** — load historical price windows and live market updates only after the user explicitly requests price analysis for the current sector
- **Runtime-Backed Sector Analyst Chat** — talk with a sector-bound analyst after price-backed analysis data is ready
- **Proposal Review and Apply Flow** — review analyst-generated taxonomy proposals and explicitly apply or dismiss them
- **Lightweight Signal History** — keep recent analysis bookmarks as message-linked summaries rather than full structured audit records

Polyinfo is not a trading client and not a news product.

## Core Boundary

Polyinfo does **not** redefine:

- Polymarket market structure or exchange semantics
- Realm chat authority
- Realm agent authority
- runtime-owned canonical agent memory

Polyinfo consumes upstream market data and creates app-local analytical objects layered above that data:

- `OfficialSectorTag`
- `CustomSectorRecord`
- `NarrativeRecord`
- `CoreVariableRecord`
- `ImportedEventRecord`
- `AnalysisSnapshot`
- `SectorChatState`

## Primary User

The primary user is an analyst who wants to:

- monitor one official or custom sector
- watch how multiple related events move across a chosen time window
- manually load price windows when they want a fresh analytical read
- debate the interpretation with a sector-local analyst agent after price data is ready
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
| External market data | Polymarket front-end taxonomy surfaces + Gamma API + market WebSocket + batch price history APIs |

Polyinfo follows the SDK-first shell pattern used by other standalone nimi apps:

- **Platform client** — `createPlatformClient({ appId: 'nimi.polyinfo', runtimeTransport: 'tauri-ipc', sessionStore })`
- **Runtime** — consumed from the returned SDK client for sector analyst sessions and analysis runs

## External Dependencies

| Dependency | Provider | Type | Purpose |
|-----------|----------|------|---------|
| Front-end taxonomy surfaces | Polymarket | REST / HTML | Official sector discovery from current Polymarket navigation |
| Gamma API | Polymarket | REST API | Event-set reconstruction and custom-sector event detail |
| Market WebSocket | Polymarket | WebSocket | Realtime market updates after explicit price loading |
| Batch Price History API | Polymarket | REST API | Historical windows for sector analysis |

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
- Tauri identifier: `app.nimi.polyinfo`

## Navigation Structure

All routes are defined in `kernel/tables/routes.yaml`.

Primary product flow:

- `/` restores the most recent sector workspace when possible
- `/sectors/:sectorId` is the main working surface

Secondary pages:

- `Signals` — recent lightweight analysis bookmarks
- `Runtime` — app-level analyst routing and runtime health controls
- `Settings` — account session, runtime summary, and local storage summary

There is no dashboard-first home and no mapping page in the active product flow.

## Object Model Summary

Current active objects and invariants are authoritative in `kernel/tables/object-model.yaml`.

High-level relationship:

- official sectors are read from Polymarket front-end taxonomy while custom sectors are stored app-locally
- `NarrativeRecord` and `CoreVariableRecord` live inside a sector-local taxonomy overlay
- `ImportedEventRecord` caches upstream event metadata for custom sectors
- `SectorChatState` keeps one sector-bound conversation state per sector
- `AnalysisSnapshot` stores a lightweight bookmark to one assistant answer for a chosen time window

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
- Polyinfo does not persist full structured explanation traces or typed signal enums inside snapshot storage
- Polyinfo does not keep embedded edit-history versions for narrative or core-variable records in the current app

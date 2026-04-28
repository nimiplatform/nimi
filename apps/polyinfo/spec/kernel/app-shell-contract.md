# App Shell Contract — PI-SHELL-*

> Shell, bootstrap, routing, layout, and app-local persistence.

## PI-SHELL-001: Sector Workspace Is Primary

Authority fence: `ACCOUNT_HARDCUT_NON_ADMITTED_APP_SLICE_FENCE`.
Polyinfo is not currently admitted as an active local first-party Runtime account/session authority for the `2026-04-28-runtime-core-account-session-broker-hardcut` topic. Existing app-local token/session bootstrap seams are fenced legacy slice behavior and must not be treated as hardcut-compliant local account truth until migrated to Runtime-issued short-lived token projection and admitted caller registration.

The sector workspace is the primary home surface of Polyinfo.

- analysts arrive in a sector workspace rather than a dashboard
- `/` should restore the most recently active sector when possible
- if no prior sector exists, the shell should fall back to the first available official sector
- if no sector can be resolved, the shell falls back to `/runtime`

## PI-SHELL-002: Standalone App Boundary

Polyinfo is a standalone app rather than a desktop subpage or runtime mod.

- Polyinfo owns its own routes, app store, and persistence policy
- Polyinfo may reuse nimi kit surfaces
- Polyinfo must not depend on desktop-private renderer internals

## PI-SHELL-003: Bootstrap Order

Bootstrap must complete in this order:

1. hydrate persisted app-local state for taxonomy overlays, sector chats, snapshots, custom sectors, imported events, and last active sector
2. read runtime defaults and shared auth session
3. initialize platform client and runtime-backed sector-analyst capability
4. hydrate the app-level runtime chat config used by Polyinfo analyst chat
5. lazily load the official sector catalog when a route needs it
6. when a sector opens, ensure that sector has local taxonomy state and a sector chat state
7. when a custom sector opens, refresh imported-event validity against upstream
8. only after the user explicitly requests price analysis, fetch historical price windows and attach realtime subscriptions for the current market set

Realtime subscription attachment remains delayed until a concrete active market set exists and the user has requested price-backed analysis.

## PI-SHELL-004: Route Ownership

Routes are authoritative in `tables/routes.yaml`.

The shell must provide direct navigation for:

- sector detail
- signal history
- runtime
- settings

Legacy compatibility redirects may exist, but no active route may reintroduce dashboard-first or mapping-first product flow.

## PI-SHELL-005: Main Layout

The main working surface is a chat-first analytical layout:

- top bar: primary category selection for official sector roots, plus secondary utility navigation
- left rail: second-level sectors for the selected primary category, or custom sectors when the custom workspace group is selected
- primary canvas: sector-local narratives, core issues, and market evidence
- right sidebar: sector analyst chat, proposal review, and runtime notices

The current app keeps market evidence and taxonomy editing in the primary canvas while the analyst chat stays visible in a dedicated sidebar.

## PI-SHELL-006: Sector Workspace Is Conversational

Every sector workspace must support sector-bound conversation.

- opening a sector restores or initializes a sector-bound analyst chat without extra setup
- the analyst panel is visible immediately, but price-backed analysis remains gated behind explicit `Load Prices`
- the chat prompt is sector-bound and price analysis, when requested, uses the sector's current narratives and core variables
- market movement views and chat remain peers in the same workspace rather than separate routes

## PI-SHELL-007: App-Local Persistence

Polyinfo must persist the following app-local objects:

- custom sector records
- sector-local narrative definitions
- sector-local core variable definitions
- imported event records for custom sectors
- last active sector selection
- sector chat state
- lightweight analysis snapshots
- app-level runtime route selection for analyst chat

Upstream market data itself remains a cacheable external projection rather than app authority.

## PI-SHELL-008: Sector Workspace Selection

The user must be able to switch sectors without losing app-local taxonomy or sector chat state for the previously active sector.

Sector switch behavior must:

- preserve stored narratives and core variables for each sector
- preserve or resumably restore the latest sector analyst chat state for each sector
- restore the last active sector on the next app entry when possible
- tear down stale realtime subscriptions when the workspace unmounts or the tracked market set changes
- load the next sector's tracked market set before reattaching realtime subscriptions
- refresh imported-event validity when opening a custom sector

## PI-SHELL-009: Chat-Initiated Structure Editing

The shell must allow narrative and core-variable maintenance from inside the analyst chat flow.

- the user may ask to create, edit, or retire narratives inside chat
- the user may ask to create, edit, or retire core variables inside chat
- analyst-originated changes are rendered as reviewable proposals before confirmation

Direct panel editing may also exist, but chat-originated editing is a first-class workflow rather than a fallback.

## PI-SHELL-011: Runtime Config Ownership

Polyinfo chat must not maintain a private per-page model selection truth.

- analyst chat route selection must read from the app-level runtime config surface
- runtime config must have its own page-level entry rather than hiding inside chat-only controls
- settings may summarize current chat routing, but must not become the write owner for runtime route selection

## PI-SHELL-012: Desktop-Aligned Chat Boundary

Polyinfo only admits the AI analyst subset of the desktop chat shell pattern.

- Polyinfo does not expose desktop human, group, or generic agent chat modes
- the sector analyst shell may reuse desktop-style chat structure, but remains bound to sector analysis semantics
- sector context, proposal review, taxonomy mutation, and lightweight signal snapshots remain Polyinfo-owned product behavior

## PI-SHELL-010: Explanation Trace Visibility

Every visible analysis surface must keep the live supporting market set in the same workspace.

The current app exposes supporting context through:

- the selected time window control
- the visible event list and market outcome cards
- displayed probability deltas and activity figures
- the sector-local narratives and core issues shown beside the market board

The current app does not yet persist a separate explanation-trace inspector inside snapshot history.

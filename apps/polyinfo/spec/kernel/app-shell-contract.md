# App Shell Contract — PI-SHELL-*

> Shell, bootstrap, routing, layout, and app-local persistence.

## PI-SHELL-001: Sector Workspace Is Primary

The sector workspace is the primary home surface of Polyinfo.

- analysts arrive in a sector workspace rather than a dashboard
- `/` should restore the most recently active sector when possible
- if no prior sector exists, the shell should fall back to the first available official sector
- the user must be able to start work immediately after entry

## PI-SHELL-002: Standalone App Boundary

Polyinfo is a standalone app rather than a desktop subpage or runtime mod.

- Polyinfo owns its own routes, app store, and persistence policy
- Polyinfo may reuse nimi kit surfaces
- Polyinfo must not depend on desktop-private renderer internals

## PI-SHELL-003: Bootstrap Order

Bootstrap must complete in this order:

1. initialize app shell and persisted app-local settings
2. read runtime defaults and shared auth session
3. initialize platform client and runtime-backed sector-analyst capability
4. hydrate the app-level runtime chat config used by Polyinfo analyst chat
5. load sector catalog source and sector-local overlay objects
6. load the active sector's narratives, core variables, and recent discussion history
7. start initial market discovery snapshot for the active sector
8. attach realtime market subscriptions for currently tracked markets

Realtime subscription attachment must remain delayed until a concrete active market set exists.

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
- information column: narratives, core issues, and event evidence
- main column: sector analyst chat, proposal review, and current read

On narrow viewports, the information column and chat column may collapse into tabs, but chat must remain the default visible surface.

## PI-SHELL-006: Sector Workspace Is Conversational

Every sector workspace must support immediate conversation.

- opening a sector must make it possible to start or resume a sector-bound analyst chat without additional setup
- the default sector chat context must already include that sector's current narratives and core variables
- market movement views and chat must be peers in the same workspace, not separate product modes

## PI-SHELL-007: App-Local Persistence

Polyinfo must persist the following app-local objects:

- custom sector records
- sector-local narrative definitions
- sector-local core variable definitions
- imported event records for custom sectors
- last active sector selection
- discussion threads
- user-selected time window and weighting preferences

Upstream market data itself remains a cacheable external projection rather than app authority.

## PI-SHELL-008: Sector Workspace Selection

The user must be able to switch sectors without losing app-local taxonomy or discussion history for the previously active sector.

Sector switch behavior must:

- preserve stored narratives and core variables for each sector
- preserve or resumably restore the latest sector analyst thread for each sector
- restore the last active sector on the next app entry when possible
- tear down stale realtime subscriptions
- load the next sector's tracked market set before reattaching realtime subscriptions
- refresh imported-event validity when opening a custom sector

## PI-SHELL-009: Chat-Initiated Structure Editing

The shell must allow narrative and core-variable maintenance from inside the analyst chat flow.

- the user may ask to create, edit, or retire narratives inside chat
- the user may ask to create, edit, or retire core variables inside chat
- proposed changes must remain reviewable before confirmation

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
- sector context, proposal review, taxonomy mutation, and signal snapshots remain Polyinfo-owned product behavior

## PI-SHELL-010: Explanation Trace Visibility

Every visible signal summary must expose an inspection path to its supporting market set.

The shell must make it possible to move from:

- sector conclusion
- to current narratives and core issues
- to underlying events, markets, and window comparisons

Polyinfo must not present opaque one-line conclusions without traceable market support.

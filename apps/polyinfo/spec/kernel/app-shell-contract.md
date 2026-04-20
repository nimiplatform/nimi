# App Shell Contract — PI-SHELL-*

> Shell, bootstrap, routing, layout, and app-local persistence.

## PI-SHELL-001: Dashboard Is Primary

Dashboard is the primary home surface of Polyinfo.

- analysts arrive here first
- dashboard is signal-first, not settings-first
- the current sector focus must be visible immediately on entry
- dashboard must provide direct entry into a live sector analyst session

## PI-SHELL-002: Standalone App Boundary

Polyinfo is a standalone app rather than a desktop subpage or runtime mod.

- Polyinfo owns its own routes, app store, and persistence policy
- Polyinfo may reuse nimi kit surfaces
- Polyinfo must not depend on desktop-private renderer internals

## PI-SHELL-003: Bootstrap Order

Bootstrap must complete in this order:

1. initialize app shell and persisted app-local settings
2. initialize platform client and runtime sector-analyst capability
3. load sector catalog source and sector-local overlay objects
4. load the active sector's narratives, core variables, and recent discussion history
5. start initial market discovery snapshot for the active sector
6. attach realtime market subscriptions for currently tracked markets

Realtime subscription attachment must remain delayed until a concrete active market set exists.

## PI-SHELL-004: Route Ownership

Routes are authoritative in `tables/routes.yaml`.

The shell must provide direct navigation for:

- sector overview
- sector detail
- signal history
- settings

## PI-SHELL-005: Main Layout

The main working surface is a three-pane analytical layout:

- left pane: sector and taxonomy navigation
- center pane: signal board and market movement views
- right pane: sector analyst chat and action panel

On narrow viewports, the right pane may collapse into a tab, but discussion must remain first-class rather than hidden behind settings-only navigation.

## PI-SHELL-006: Sector Workspace Is Conversational

Every sector workspace must support immediate conversation.

- opening a sector must make it possible to start or resume a sector-bound analyst chat without additional setup
- the default sector chat context must already include that sector's current narratives and core variables
- market movement views and chat must be peers in the same workspace, not separate product modes

## PI-SHELL-007: App-Local Persistence

Polyinfo must persist the following app-local objects:

- sector-local narrative definitions
- sector-local core variable definitions
- manual market-to-narrative mappings
- manual market-to-core-variable relevance overrides
- discussion threads
- user-selected time window and weighting preferences

Upstream market data itself remains a cacheable external projection rather than app authority.

## PI-SHELL-008: Sector Workspace Selection

The user must be able to switch sectors without losing app-local taxonomy or discussion history for the previously active sector.

Sector switch behavior must:

- preserve stored narratives and core variables for each sector
- preserve or resumably restore the latest sector analyst thread for each sector
- tear down stale realtime subscriptions
- load the next sector's tracked market set before reattaching realtime subscriptions

## PI-SHELL-009: Chat-Initiated Structure Editing

The shell must allow narrative and core-variable maintenance from inside the analyst chat flow.

- the user may ask to create, edit, retire, or remap narratives inside chat
- the user may ask to create, edit, retire, or remap core variables inside chat
- proposed changes must remain reviewable before confirmation

Separate management screens may exist, but chat-originated editing is a first-class workflow rather than a fallback.

## PI-SHELL-010: Explanation Trace Visibility

Every visible signal summary must expose an inspection path to its supporting market set.

The shell must make it possible to move from:

- sector signal summary
- to narrative cluster
- to core variable view
- to underlying markets and window comparisons

Polyinfo must not present opaque one-line conclusions without traceable market support.

# App Shell Contract — AM-SHELL-*

> Tauri shell, bootstrap, navigation, and app-level framing.

## AM-SHELL-001: App Shape

Asset Market is a standalone desktop application with an SDK-first boundary.

- Shell responsibility: window, bootstrap, auth/session, route rendering
- Business responsibility: discover, library, publish, account
- Realm asset truth remains outside the app per `R-ASSET-*`

## AM-SHELL-002: Bootstrap Pattern

Asset Market follows the Forge-style bootstrap pattern:

1. Load runtime defaults
2. Create platform client (`runtime`, `realm`)
3. Resolve auth session
4. Initialize query/store providers
5. Render app shell

Asset Market does not introduce app-local asset truth or raw REST fallback paths.

## AM-SHELL-003: Primary Navigation

The primary navigation is fixed to four sections:

- `Discover`
- `Library`
- `Publish`
- `Account`

`Discover` is the default landing surface.

All route enumerations live in `tables/routes.yaml`.

## AM-SHELL-004: Discover-First Home

The app home is a discover surface, not a management dashboard.

- Search is prominent
- Category browsing is first-class
- New and Popular are the initial market views
- Publish and Account are secondary entry points

## AM-SHELL-005: Lightweight Market Posture

Asset Market is a creator market, not a full commerce back office.

Current shell scope excludes:

- complex merchant analytics
- invoice/tax centers
- advanced review moderation consoles
- marketplace experiment dashboards

Those may be added later without changing the current shell contract.

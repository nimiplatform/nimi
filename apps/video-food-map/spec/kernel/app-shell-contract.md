# Video Food Map App Shell Contract

> Rule namespace: VFM-SHELL-*
> Normative Imports: P-DESIGN-*, P-KIT-*

## VFM-SHELL-001 — Standalone App Boundary

Video Food Map is a standalone app under `apps/video-food-map/`. It must not be specified as a tab or feature slice inside the existing Desktop shell.

## VFM-SHELL-002 — Core Product Surfaces

The app shell must reserve first-class space for:

- personal space dashboard
- food map surface
- review queue
- profile / preference surface

Video intake and creator sync remain admitted product actions, but they are support actions inside the personal space rather than the shell's only reason to exist.

## VFM-SHELL-003 — Runtime and SDK Dependency Boundary

The app consumes `nimi-runtime` through typed SDK runtime surfaces. Product code must not depend on ad hoc provider requests as its mainline path.

## VFM-SHELL-004 — Stage Separation

The shell must separate:

- personal-space baseline
- runtime-backed discovery and review
- later menu-advice enhancement

A blocked later-stage feature must not block the shipped personal-space baseline from continuing to ship.

## VFM-SHELL-005 — Kit-First UI Contract

The app follows `P-KIT-065` kit-first protocol. All shell-level UI must be composed from `@nimiplatform/nimi-kit/ui` shared primitives. App-local UI components are permitted only for domain-specific surfaces not covered by kit (e.g. map rendering, extraction progress).

## VFM-SHELL-006 — Theme Pack

The app must import foundation schemes (`light.css`, `dark.css`) and exactly one accent pack (`video-food-map-accent.css`) per `P-DESIGN-002`. The app root must wrap with `NimiThemeProvider`.

## VFM-SHELL-007 — Surface-to-Primitive Mapping

Product surfaces must use kit primitives as follows:

| Product Surface | Kit Primitives |
|---|---|
| Personal Space Dashboard | AmbientBackground, Surface (hero/panel/card), SearchField, Button, StatusBadge, ScrollArea |
| Food Map Surface | Surface (canvas/panel/card) + app-local map renderer + Button + SelectField |
| Review Queue | Surface (panel/card), ScrollArea, StatusBadge, Button |
| Profile / Preference Surface | Surface (panel/card), Button, SelectField, StatusBadge |

App-local composition components are permitted for map rendering and extraction visualization, but must be registered in `nimi-ui-compositions.yaml` per `P-DESIGN-019`.

## VFM-SHELL-008 — Adoption Registration

Each shell-level module must be registered in `nimi-ui-adoption.yaml` per `P-DESIGN-020`, declaring `scheme_support: [light, dark]`, `default_scheme: light`, and `accent_pack: video-food-map-accent`.

## VFM-SHELL-009 — Personal Space First-Screen Priority

The first screen must read as the user's personal food space, not as a narrow import tool.

- the shell's primary heading and first large surface must center the user's saved places, current shortlist, and food profile
- intake and creator-sync controls may stay globally accessible, but they must not visually dominate the dashboard over saved places, favorites, or review work
- favorites, confirmed venues, and recent discovery evidence are first-class dashboard content, not secondary debug metadata

## VFM-SHELL-010 — Glass Material Direction

The app may reference Desktop's glass-forward visual language, but only through admitted shared material primitives.

- shell chrome, hero panels, and summary cards may use `glass-thin`, `glass-regular`, or `glass-thick` materials through `Surface`
- app code must not inline raw glass backgrounds, raw blur utilities, or app-local material tiers outside the shared kit contract
- when transparency is reduced or unsupported, the shell must stay legible and continue to read as one coherent space

## VFM-SHELL-011 — Runtime Route Settings Surface

The shell must expose app-owned route settings for at least:

- speech transcription
- text extraction

Available local and cloud options must be loaded from typed runtime surfaces, not hard-coded into the app. The chosen route settings must persist in app-managed settings so later imports can reuse them.

## VFM-SHELL-012 — Preference Profile Surface

Before menu capture ships, the shell must already expose a first-class surface for collecting the user's dining preference profile.

- this surface is part of the personal-space baseline rather than a hidden future-only placeholder
- profile setup must use app-managed local settings, not temporary in-memory state
- saving the profile early must not imply that menu capture or dish generation is already available

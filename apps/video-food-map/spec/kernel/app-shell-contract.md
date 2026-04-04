# Video Food Map App Shell Contract

> Rule namespace: VFM-SHELL-*
> Normative Imports: P-DESIGN-*, P-KIT-*

## VFM-SHELL-001 — Standalone App Boundary

Video Food Map is a standalone app under `apps/video-food-map/`. It must not be specified as a tab or feature slice inside the existing Desktop shell.

## VFM-SHELL-002 — Core Product Surfaces

The app shell must reserve first-class space for:

- video intake
- creator search
- map surface
- review queue
- menu advisor

Review queue and menu advisor may launch later, but they remain product-level surfaces, not hidden debug panels.

## VFM-SHELL-003 — Runtime and SDK Dependency Boundary

The app consumes `nimi-runtime` through typed SDK runtime surfaces. Product code must not depend on ad hoc provider requests as its mainline path.

## VFM-SHELL-004 — Stage Separation

Stage 1 single-video discovery, stage 2 creator-scaled intake and stronger review, and stage 3 menu advice must remain separable. A blocked later-stage feature must not block the shipped stage-1 discovery product from continuing to ship.

## VFM-SHELL-005 — Kit-First UI Contract

The app follows `P-KIT-065` kit-first protocol. All shell-level UI must be composed from `@nimiplatform/nimi-kit/ui` shared primitives. App-local UI components are permitted only for domain-specific surfaces not covered by kit (e.g. map rendering, extraction progress).

## VFM-SHELL-006 — Theme Pack

The app must import foundation schemes (`light.css`, `dark.css`) and exactly one accent pack (`video-food-map-accent.css`) per `P-DESIGN-002`. The app root must wrap with `NimiThemeProvider`.

## VFM-SHELL-007 — Surface-to-Primitive Mapping

Product surfaces must use kit primitives as follows:

| Product Surface | Kit Primitives |
|---|---|
| Video Intake | Surface (panel), SearchField, Button, StatusBadge |
| Creator / Venue Discovery | SearchField, SelectField, Sidebar (entity-row), ScrollArea, StatusBadge |
| Map Surface | Surface (canvas) + app-local map renderer + Button |
| Review Queue | Surface (panel/card), ScrollArea, StatusBadge, Button |
| Menu Advisor | Surface (placeholder or future panel), StatusBadge, Button |

App-local composition components are permitted for map rendering and extraction visualization, but must be registered in `nimi-ui-compositions.yaml` per `P-DESIGN-019`.

## VFM-SHELL-008 — Adoption Registration

Each shell-level module must be registered in `nimi-ui-adoption.yaml` per `P-DESIGN-020`, declaring `scheme_support: [light, dark]`, `default_scheme: light`, and `accent_pack: video-food-map-accent`.

## VFM-SHELL-009 — Runtime Route Settings Surface

The shell must expose app-owned route settings for at least:

- speech transcription
- text extraction

Available local and cloud options must be loaded from typed runtime surfaces, not hard-coded into the app. The chosen route settings must persist in app-managed settings so later imports can reuse them.

## VFM-SHELL-010 — Pre-Menu Preference Setup Surface

Before menu capture ships, the shell may still expose a first-class surface for collecting the user's dining preference profile.

- this surface may live under the existing menu-advisor entry instead of staying a pure placeholder
- profile setup must use app-managed local settings, not temporary in-memory state
- saving the profile early must not imply that menu capture or dish generation is already available

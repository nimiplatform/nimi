# Video Food Map Execution Plan

## Delivery Shape

Video Food Map should be delivered as a real standalone app under `apps/video-food-map/`, not as a Desktop sub-panel.

The delivery order should be:

1. make the app a valid product shell
2. turn the current probe work into app-owned records
3. ship creator and venue discovery before enrichment
4. promote only confirmed, geocoded records onto the map
5. add review and menu flows later without reopening stage-1 contracts

## Current Blocking Facts

- `apps/video-food-map/` currently contains spec and validation scripts only; there is no package, renderer entry, shell, theme entry, or test harness yet
- the current Bilibili work proves extraction direction, but it is still validation-script based and does not yet persist canonical app records
- no map dependency is installed anywhere in the repo today
- the required `video-food-map-accent` theme pack does not exist yet in the shared theme tables or kit exports
- creator batch intake, comment supplement, review queue, and geocoding are specified but not yet implemented

## Recommended Product Decisions

### Decision 1: App shape

Start from the same standalone shell pattern used by the other small apps in this repo, not from Desktop feature code.

### Decision 2: Map rendering

Use an app-owned `MapSurface` backed by MapLibre GL JS.

Why this is the default:

- it fits the spec requirement that map rendering remains app-owned
- it keeps renderer choice separate from provider choice
- it leaves room for clustering, stronger styling, and larger result sets without rebuilding the map surface later

### Decision 3: Geocoding

Do not plan around public Nominatim as the product geocoder.

Instead:

- define a provider seam from day one
- allow stage 1 to show text-only records in search and review
- allow map promotion only for records with confirmed coordinates
- choose the actual provider before stage-1 map release

### Decision 4: Search release order

Ship list and filter discovery before review automation and before menu advice.

This gives a usable app earlier while staying inside the stage-separation rules.

## Phase 0 — Foundation and Governance

Goal: make `apps/video-food-map` a real app workspace that can be built, tested, and governed.

- create the app package, renderer entry, styles, shell providers, routes, and basic test setup
- choose the standalone shell template to copy from and keep the initial shell minimal
- add `video-food-map-accent` to the shared theme tables and kit export surface
- register shell modules in `nimi-ui-adoption.yaml`
- register app-owned compositions in `nimi-ui-compositions.yaml` for the map surface and any extraction-only visuals
- add the minimum app scripts for build, typecheck, lint, and test

Phase 0 is done when:

- the app can boot as its own standalone shell
- the shared theme checks pass with `video-food-map-accent`
- the repo recognizes the app as a normal workspace package

## Phase 1 — Canonical Records and Intake Baseline

Goal: stop treating probe output as scratch-only and establish the first real product records.

- define the canonical app record shape for:
  - intake record
  - creator
  - video source
  - venue candidate
  - evidence bundle
  - extraction coverage
  - review state
- promote the existing Bilibili probe types where they are already correct instead of redefining them in parallel
- build app-managed persistence for canonical records
- wire single-video intake into persistence
- keep subtitle-first extraction and STT fallback from the current validation path
- preserve partial-coverage disclosure for long videos
- merge repeated intake of the same canonical video into the same record by default

Phase 1 is done when:

- one Bilibili link can produce persisted app records
- rerunning the same video updates the same record instead of duplicating it
- a stored record still shows creator, source video, store candidate, address clue, dishes, cuisine, flavor, evidence, confidence, review state, and coverage state

## Phase 2 — Searchable Discovery Without False Map Truth

Goal: make the app useful before advanced confirmation work lands.

- build the shell around the required product surfaces:
  - video intake
  - creator search
  - map surface
  - review queue placeholder
  - menu advisor placeholder
- implement creator, area, store, dish, cuisine, flavor, and review-state filtering
- use kit primitives for search, list, cards, badges, dialogs, and sidebars
- keep unresolved records searchable
- clearly separate:
  - confirmed map-ready records
  - searchable but unresolved records
  - conflicting records in review

Phase 2 is done when:

- users can search and filter persisted records across all required dimensions
- search results preserve creator-specific evidence
- unresolved records are visible in the app but never shown as confirmed map results

## Phase 3 — Map Release on Confirmed Coordinates Only

Goal: release the first trustworthy map, not the first visually complete map.

- add the app-owned `MapSurface`
- introduce a map adapter seam:
  - renderer adapter
  - tile/style provider config
  - geocoding provider config
- geocode only the fields needed for venue confirmation
- cache geocoding results in app-managed storage
- render only confirmed records with usable coordinates
- support marker selection, result focus, and filter-linked map state
- add basic clustering and viewport fitting only after single-marker flow is correct

Phase 3 is done when:

- the map can render confirmed venues from persisted records
- text-only or unresolved records remain off-map
- geocoding failures fall back to review/search state, not silent map promotion

## Phase 4 — Batch Intake, Comment Completion, and Review Queue

Goal: make the app grow its venue truth responsibly.

- add creator-scoped batch intake via the platform space API with incremental diff
- add comment-based store and address completion via the public reply API
- add a review queue that groups:
  - unresolved store identity
  - unresolved address
  - conflicting evidence
  - geocoding failure
- allow later signals to promote a record out of review, but never silently overwrite conflicting stage-1 evidence
- add lightweight operator actions for confirm, keep-in-review, and reject map promotion

Phase 4 is done when:

- creator batch intake only brings in new videos by default
- comment clues can resolve missing store or address details
- conflicting clues stay visible in review instead of mutating confirmed truth

## Phase 5 — Menu Advisor

Goal: add dining help only after venue truth is stable enough to trust.

- add menu photo intake
- use confirmed venue truth or captured menu items as the only basis for dish suggestions
- add dietary restriction, taboo ingredient, party-size, and flavor preference inputs
- make every suggestion explain why it is recommended, flagged, or excluded

Phase 5 is done when:

- menu advice depends on real menu or confirmed venue truth
- uncertain advice stays visibly uncertain

## Non-Blocking Work That Should Not Delay Stage 1

- targeted visual clue extraction
- cross-platform creator identity
- broad visual polish beyond the shared shell baseline
- advanced map styling
- menu advisor UX depth

## Practical Order of Implementation

If only one team is pushing this forward, the safest order is:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5

If multiple people are working in parallel, the split should be:

- track A: app shell, theme, registry, search UI
- track B: canonical record model and persistence
- track C: map adapter and geocoding seam

Track C should not hard-code a public geocoder before the product decision is made.

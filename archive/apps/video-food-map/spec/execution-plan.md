# Video Food Map Execution Plan

## Delivery Shape

Video Food Map should be delivered as a real standalone app under `apps/video-food-map/`, not as a Desktop sub-panel.

The delivery order is now:

1. reshape the standalone shell into a personal food space without breaking canonical records
2. harden personal-space discovery, map, and review flows
3. add creator-scaled intake and richer review actions
4. add menu capture and dining advice last

## Current Baseline

The current app baseline already includes:

- a real standalone workspace package with renderer, Tauri shell, tests, theme pack, and adoption/composition registration
- single-video Bilibili intake with persisted SQLite records keyed to the canonical video
- creator-homepage sync for recent Bilibili videos, with incremental diff against already-known records
- subtitle-first extraction with speech fallback and partial-coverage disclosure for long videos
- public-comment clue screening plus store/address completion when comments strengthen the first-pass result
- app-owned map rendering and geocoding using the current AMap-backed implementation
- searchable discovery across creator, area, venue, dish, cuisine, flavor, and review state
- a shipped review queue with manual confirmation and favorites
- runtime-backed route settings for speech transcription and text extraction
- a menu-advisor placeholder surface, but not the stage-3 feature itself

## Remaining Gaps

The biggest gaps relative to the intended product are:

- the first screen still reads more like an intake tool than a personal food space
- saved places, favorites, review work, and dining profile are not yet framed as one coherent personal dashboard
- creator intake still lacks deeper history sync, re-sync controls, and persistent sync management
- targeted visual clues are not shipped yet
- review tooling is still lightweight; there is no explicit reject / keep-in-review workflow yet
- menu photo capture and dining advice are still future work

## Phase 1 — Personal Space Baseline

Goal: make the app feel like the user's own food space while keeping the current discovery pipeline trustworthy.

- preserve one-video-one-record dedupe behavior
- make favorites, confirmed venues, recent discovery work, and dining profile first-class shell content
- keep comment-based completion subordinate to the first extraction pass
- keep map promotion fail-close on missing coordinates
- preserve user confirmation and favorites as app-owned curation actions
- keep runtime route settings sourced from live runtime options, not hard-coded lists

Phase 1 is done when:

- the shell's first screen is clearly a personal-space dashboard instead of only an intake panel
- repeated imports refresh the same video record instead of multiplying it
- unresolved records remain searchable and reviewable but off-map
- operator curation does not bypass the coordinate gate

## Phase 2 — Creator-Scaled Intake and Stronger Review

Goal: increase venue coverage without weakening record trust.

- extend creator-scoped intake beyond the shipped recent-video homepage sync
- expand review actions beyond confirm/favorite into explicit keep-in-review or reject flows
- add better conflict presentation for comment clues and future visual clues
- keep batch intake creator-scoped only; no site-wide crawling

Phase 2 is done when:

- batch intake only pulls new creator videos by default
- operators can leave a record unresolved without silently promoting or overwriting it
- conflicting evidence stays visible as conflict, not flattened into fake certainty

## Phase 3 — Targeted Visual Clues

Goal: use visual evidence only where text and comments still leave ambiguity.

- add storefront, sign, or menu clue extraction only for unresolved store/address cases
- keep visual evidence as a supplement, not the default path for every video
- record why a visual clue changed confidence or left the item in review

Phase 3 is done when:

- visual clues are only invoked for unresolved cases
- conflicting visual evidence still routes to review instead of silent promotion

## Phase 4 — Menu Advisor

Goal: add dining help only after venue truth is stable enough to rely on.

- add menu photo intake
- use confirmed venue truth or captured menu items as the basis for dish suggestions
- add dietary restriction, taboo ingredient, party-size, and flavor preference inputs
- make every suggestion explain why it is suggested, flagged, or excluded

Phase 4 is done when:

- menu advice depends on real menu data or confirmed venue truth
- uncertain advice stays visibly uncertain

## Non-Blocking Work

- cross-platform creator identity
- broader visual polish beyond the personal-space baseline
- future map-provider abstraction if the current AMap-backed implementation stops fitting product needs
- deeper menu-advisor UX once stage-3 behavior exists

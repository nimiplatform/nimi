# Video Food Map Execution Plan

## Phase 1

- single video intake via cookieless direct API (playurl + player v2)
- platform subtitle-first; STT fallback via FFmpeg transcoding
- creator batch intake via space API with incremental diff
- Bilibili-first extraction validation
- map promotion for locatable records
- creator / store / dish / cuisine / flavor search
- partial-coverage disclosure for long-video validation

## Phase 2

- comment-based store name and address completion via reply API
- targeted visual clue extraction
- stronger store/address confirmation
- coordinate confirmation for map promotion
- review queue tooling

## Phase 3

- menu photo intake
- dietary warning
- party-size and flavor-based dish recommendation

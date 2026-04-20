# Video Food Map Spec

> Scope: personal food space built from creator-video discovery, saved venue curation, map search, and staged dining assistance
> Normative Imports: spec/runtime/kernel/multimodal-provider-contract.md, spec/sdk/kernel/runtime-contract.md

## 0. Authoritative Imports

- K-MMPROV-* — runtime multimodal input and output contract
- K-JOB-* — async media job lifecycle
- S-RUNTIME-* — SDK runtime surface and transport usage
- S-SURFACE-* — typed surface usage from the SDK
- P-DESIGN-* — cross-app design pattern, shared primitives, theme packs
- P-KIT-* — nimi-kit package contract and kit-first protocol

## 1. Document Positioning

Video Food Map is a standalone app, not a panel inside Desktop.

Its product baseline is:

1. accept creator video links and creator-homepage sync as intake actions
2. extract store, dishes, cuisine and flavor tags from the video
3. turn confirmed or mappable records into a personal food map
4. preserve favorites, shortlist signals, and dining preferences as app-owned personal state
5. add menu-based dining advice only after the personal-space baseline is stable

The product truth unit is a single video extraction record. Multi-creator aggregation is built by combining those records, not by inventing a second truth source.

## 2. Module Map

| Module | Purpose |
|--------|---------|
| Personal Space Dashboard | center the user's saved places, favorites, recent discovery evidence, and decision support |
| Video Intake | accept Bilibili (stage 1), Douyin and user-submitted links (future) |
| Runtime Route Settings | choose local or cloud routes for speech transcription and text extraction from current runtime options |
| Creator Intake | sync a Bilibili creator homepage's recent videos into the existing extraction pipeline; deeper history is future work |
| Extraction Pipeline | platform subtitles or speech transcription, structured recommendation extraction |
| Comment Supplement | store name and address completion from filtered public video comments |
| Review Queue | unresolved store names, address conflicts, mixed-result cleanup |
| Creator Search | search by creator, area, dish, cuisine, flavor |
| Map Surface | show only locatable food records, support current-location nearby discovery, and hand off to navigation |
| User Curation | manual confirmation and favorites on venue candidates |
| Dining Preference Profile | persist taboo ingredients, dietary restrictions, and taste preferences for later dining advice |
| Menu Advisor | capture menu photos and produce dining suggestions |

## 3. Staged Scope

### Stage 1

- single video in, cookieless public video access via direct API
- platform subtitle-first; speech transcription as fallback
- structured recommendation record out
- public-comment clue screening and store/address completion
- personal dashboard that foregrounds favorites, confirmed places, and recent discovery work
- locatable records on map
- explicit current-location lookup for nearby mapped venues
- creator / store / dish / cuisine / flavor search
- review queue, manual confirmation, and favorites
- runtime route settings for speech and text extraction
- saved dining preference profile for later dining advice
- partial-coverage disclosure for long-video validation

### Stage 2

- extend creator batch intake beyond the shipped recent-homepage sync
- targeted visual clues from storefronts, signs, menus
- stronger store/address confirmation
- area search strengthened by confirmed coordinates
- richer operator actions in review beyond simple confirm/favorite

### Stage 3

- menu capture
- dietary warnings using the saved dining preference profile
- party-size and flavor-preference dish suggestions

## 4. Platform Scope

- Stage 1: Bilibili only. URL pattern and metadata structure are Bilibili-specific.
- Future: Douyin + Bilibili + user-submitted arbitrary video links.
- Cross-platform creator dedup (same person on Bilibili and Douyin) is a future concern, not a stage-1 requirement.

## 5. Non-Goals

- no site-wide crawling; batch intake is creator-scoped only
- no dependence on Dianping-like external APIs as a launch precondition
- no full-video visual understanding as the default extraction path
- no yt-dlp or heavy external CLI dependencies; video and audio fetching uses direct platform APIs
- no public social feed, follower graph, or "who recommended this to me" activity layer in the personal-space baseline

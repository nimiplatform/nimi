# Video Food Map Spec

> Scope: creator-video food discovery app with map search, recommendation extraction, and staged dining assistance
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

1. accept creator video links
2. extract store, dishes, cuisine and flavor tags from the video
3. promote locatable records onto a map
4. support creator-centric and dish-centric search
5. add menu-based dining advice only after the first-stage extraction path is stable

The product truth unit is a single video extraction record. Multi-creator aggregation is built by combining those records, not by inventing a second truth source.

## 2. Module Map

| Module | Purpose |
|--------|---------|
| Video Intake | accept Bilibili (stage 1), Douyin and user-submitted links (future) |
| Creator Intake | pull a creator's full video list and feed new entries into the extraction pipeline |
| Extraction Pipeline | platform subtitles or speech transcription, structured recommendation extraction |
| Comment Supplement | store name and address completion from video comments |
| Review Queue | unresolved store names, address conflicts, mixed-result cleanup |
| Creator Search | search by creator, area, dish, cuisine, flavor |
| Map Surface | show only locatable food records |
| Menu Advisor | capture menu photos and produce dining suggestions |

## 3. Staged Scope

### Stage 1

- single video in, cookieless public video access via direct API
- platform subtitle-first; speech transcription as fallback
- creator batch intake via platform space API with incremental diff
- structured recommendation record out
- locatable records on map
- creator / store / dish / cuisine / flavor search
- partial-coverage disclosure for long-video validation

### Stage 2

- comment-based store name and address completion via reply API
- targeted visual clues from storefronts, signs, menus
- stronger store/address confirmation
- area search strengthened by confirmed coordinates

### Stage 3

- menu capture
- dietary warnings
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

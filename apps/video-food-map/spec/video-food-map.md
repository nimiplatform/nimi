# Video Food Map Spec

> Scope: creator-video food discovery app with map search, recommendation extraction, and staged dining assistance
> Normative Imports: spec/runtime/kernel/multimodal-provider-contract.md, spec/sdk/kernel/runtime-contract.md

## 0. Authoritative Imports

- K-MMPROV-* — runtime multimodal input and output contract
- K-JOB-* — async media job lifecycle
- S-RUNTIME-* — SDK runtime surface and transport usage
- S-SURFACE-* — typed surface usage from the SDK

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
| Video Intake | accept Bilibili / future creator video links |
| Extraction Pipeline | metadata, transcription, structured recommendation extraction |
| Review Queue | unresolved store names, address conflicts, mixed-result cleanup |
| Creator Search | search by creator, area, dish, cuisine, flavor |
| Map Surface | show only locatable food records |
| Menu Advisor | capture menu photos and produce dining suggestions |

## 3. Staged Scope

### Stage 1

- single video in
- structured recommendation record out
- locatable records on map
- creator / store / dish / cuisine / flavor search
- partial-coverage disclosure for long-video validation

### Stage 2

- comment-based store name clues
- targeted visual clues from storefronts, signs, menus
- stronger store/address confirmation
- area search strengthened by confirmed coordinates

### Stage 3

- menu capture
- dietary warnings
- party-size and flavor-preference dish suggestions

## 4. Non-Goals

- no requirement to batch-crawl all creator videos in stage 1
- no dependence on Dianping-like external APIs as a launch precondition
- no full-video visual understanding as the default extraction path

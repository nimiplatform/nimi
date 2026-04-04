# Video Food Map Extraction Contract

> Rule namespace: VFM-PIPE-*

## VFM-PIPE-001 — Canonical Intake Unit

The canonical intake unit is one creator video link. Every extracted record must preserve a back-reference to the source video and creator.

## VFM-PIPE-002 — Stage-Bounded Extraction Order

The default extraction order is fixed:

1. title / description / tags / visible metadata
2. platform subtitles first; speech transcription only when platform subtitles are unavailable
3. structured recommendation extraction
4. public comments may be cross-checked as store-name or address clues after the first structured extraction pass

Later stages may extend the same record with:

5. targeted visual clues only when store or address remains unresolved

The product must not default to full-video visual understanding for every input.

## VFM-PIPE-003 — Long Video Coverage Disclosure

For long creator videos, the current product path may process leading audio segments first. This is a valid shipping path for recommendation extraction before full-length processing is expanded.

If extraction coverage is partial, the record must retain:

- extraction coverage state
- processed segment count
- processed duration or end timestamp

Partial coverage records remain valid for recommendation validation, but they must not be presented as if the full video has already been processed.

## VFM-PIPE-004 — Structured Record Minimum

Each extracted record must retain, whether sourced from platform metadata, transcript extraction, or later enrichment:

- creator identity, using the platform's stable numeric id (e.g. Bilibili `owner.mid`) as the primary key and display name as companion metadata
- source video link
- store name candidate
- address text or geographic candidate
- recommended dishes
- cuisine tags
- flavor tags
- supporting evidence
- confidence
- review state
- extraction coverage state

Optional helper fields such as video summary, recommendation polarity, selected route/model provenance, or retained public-comment clues may exist, but they are not substitutes for the canonical fields above.

## VFM-PIPE-005 — Fail-Close on Store Truth

If store identity and location remain unresolved, the record may stay searchable or reviewable, but it must not be promoted onto the map as a confirmed venue.

## VFM-PIPE-006 — Multi-Venue Separation

If one video covers multiple venues, the pipeline must emit separate venue-level records. It must not merge different stores into a single map truth record just because they came from the same video.

## VFM-PIPE-007 — Duplicate Intake Handling

Repeated submissions of the same canonical source video link must merge into the same intake record by default. The app may refresh extraction artifacts, but it must not create duplicate creator-video truth records unless the user explicitly asks for a separate rerun snapshot.

## VFM-PIPE-008 — Validation Artifact Boundary

Local probe files are validation artifacts only. Canonical app records must persist in app-managed storage and must not treat local scratch files as the product data store.

## VFM-PIPE-009 — STT Language Strategy

The extraction pipeline should use automatic language detection when the STT model supports it. If auto-detect is unavailable for the chosen model, the pipeline must accept an explicit language override. The default must not be hard-coded to a single dialect.

## VFM-PIPE-010 — Cookieless Public Video Access

For public videos, the pipeline must prefer direct platform APIs over HTML page scraping. Bilibili audio streams should be obtained via the playurl API (`/x/player/playurl`) and platform subtitles via the player API (`/x/player/v2`), both of which do not require login state for public content. Cookie-based access may remain as a fallback for restricted content, but must not be the default path.

When selecting audio CDN URLs from the playurl response, the pipeline must prefer standard CDN hosts (`*.bilivideo.com`) over MCDN/P2P nodes (`*.mcdn.bilivideo.cn`), which are unreliable for cookieless access. Backup URLs in the playurl response provide standard CDN alternatives.

## VFM-PIPE-011 — Future Creator Batch Intake Boundary

Creator-scoped batch intake remains a later-stage extension. When this feature is exposed, it must: given a creator's platform id (e.g. Bilibili `mid`), enumerate the creator's published videos via the platform space API (e.g. `/x/space/wbi/arc/search`), diff against already-known intake records, and feed new video entries into the single-video extraction pipeline. Batch intake is creator-scoped only; site-wide crawling is a non-goal.

## VFM-PIPE-012 — Audio Transcoding Portability

Audio transcoding must use FFmpeg, not platform-specific tools (e.g. macOS `afconvert`). The pipeline must be runnable on both macOS and Linux.

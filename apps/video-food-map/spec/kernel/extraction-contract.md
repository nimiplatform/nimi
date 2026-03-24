# Video Food Map Extraction Contract

> Rule namespace: VFM-PIPE-*

## VFM-PIPE-001 — Canonical Intake Unit

The canonical intake unit is one creator video link. Every extracted record must preserve a back-reference to the source video and creator.

## VFM-PIPE-002 — Default Extraction Order

Default extraction order is fixed:

1. title / description / tags / visible metadata
2. subtitles or speech transcription
3. structured recommendation extraction
4. comments as store-name clues
5. targeted visual clues only when store or address remains unresolved

The product must not default to full-video visual understanding for every input.

## VFM-PIPE-003 — Long Video Validation Strategy

For long creator videos, the stage-1 validation path may process leading audio segments first. This is a valid product path for proving recommendation extraction before full-length processing is expanded.

## VFM-PIPE-004 — Structured Record Minimum

Each extracted record must retain:

- creator identity
- source video link
- store name candidate
- address text or geographic candidate
- recommended dishes
- cuisine tags
- flavor tags
- supporting evidence
- confidence
- review state

## VFM-PIPE-005 — Fail-Close on Store Truth

If store identity and location remain unresolved, the record may stay searchable or reviewable, but it must not be promoted onto the map as a confirmed venue.

## VFM-PIPE-006 — Multi-Venue Separation

If one video covers multiple venues, the pipeline must emit separate venue-level records. It must not merge different stores into a single map truth record just because they came from the same video.

# Video Food Map Extraction Contract

> Rule namespace: VFM-PIPE-*

## VFM-PIPE-001 — Canonical Intake Unit

The canonical intake unit is one creator video link. Every extracted record must preserve a back-reference to the source video and creator.

## VFM-PIPE-002 — Stage-Bounded Extraction Order

Stage 1 default extraction order is fixed:

1. title / description / tags / visible metadata
2. subtitles or speech transcription
3. structured recommendation extraction

Stage 2 may extend the same record with:

4. comments as store-name or address clues
5. targeted visual clues only when store or address remains unresolved

The product must not default to full-video visual understanding for every input.

## VFM-PIPE-003 — Long Video Coverage Disclosure

For long creator videos, the stage-1 validation path may process leading audio segments first. This is a valid product path for proving recommendation extraction before full-length processing is expanded.

If extraction coverage is partial, the record must retain:

- extraction coverage state
- processed segment count
- processed duration or end timestamp

Partial coverage records remain valid for recommendation validation, but they must not be presented as if the full video has already been processed.

## VFM-PIPE-004 — Structured Record Minimum

Each extracted record must retain, whether sourced from platform metadata, transcript extraction, or later enrichment:

- creator identity, using a stable platform creator id when available and display name as companion metadata
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

Optional helper fields such as video summary or recommendation polarity may exist, but they are not substitutes for the canonical fields above.

## VFM-PIPE-005 — Fail-Close on Store Truth

If store identity and location remain unresolved, the record may stay searchable or reviewable, but it must not be promoted onto the map as a confirmed venue.

## VFM-PIPE-006 — Multi-Venue Separation

If one video covers multiple venues, the pipeline must emit separate venue-level records. It must not merge different stores into a single map truth record just because they came from the same video.

## VFM-PIPE-007 — Duplicate Intake Handling

Repeated submissions of the same canonical source video link must merge into the same intake record by default. The app may refresh extraction artifacts, but it must not create duplicate creator-video truth records unless the user explicitly asks for a separate rerun snapshot.

## VFM-PIPE-008 — Validation Artifact Boundary

Local probe files are validation artifacts only. Canonical app records must persist in app-managed storage and must not treat local scratch files as the product data store.

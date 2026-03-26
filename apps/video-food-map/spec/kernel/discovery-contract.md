# Video Food Map Discovery Contract

> Rule namespace: VFM-DISC-*

## VFM-DISC-001 — Map Promotion Rule

Only records with a usable store location may appear as confirmed map cards.

## VFM-DISC-002 — Creator Search Rule

Search and filter must support at least:

- creator
- area
- store
- recommended dish
- cuisine
- flavor
- review state

## VFM-DISC-003 — Evidence Preservation

Map cards and search results must preserve creator-specific evidence. The app must not flatten multiple creator recommendations into a source-less summary.

## VFM-DISC-004 — Store Confirmation Follows Extraction Order

Store confirmation must follow `VFM-PIPE-002`:

- stage 1 uses video body text (`title`, `description`, `tags`) and transcription
- stage 2 may add comments, then targeted visual clues

Comment or visual clues that conflict with stage-1 evidence must keep the record in review state.

## VFM-DISC-005 — Review Queue is Product Surface

Unresolved or conflicting records are not discarded. They enter a review queue so later signals can promote them into map truth.

## VFM-DISC-006 — Geocoding Gate

Address text or geographic candidates must be normalized into usable map coordinates before map promotion. Text-only location clues may remain searchable or reviewable, but they are not yet confirmed map locations.

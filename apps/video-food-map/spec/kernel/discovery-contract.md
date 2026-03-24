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

## VFM-DISC-004 — Store Confirmation Order

Store confirmation order is fixed:

1. video正文 and transcription
2. comments
3. targeted visual clues

Comment or visual clues that conflict with the spoken/video text must keep the record in review state.

## VFM-DISC-005 — Review Queue is Product Surface

Unresolved or conflicting records are not discarded. They enter a review queue so later signals can promote them into map truth.

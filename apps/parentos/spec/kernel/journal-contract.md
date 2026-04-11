# Journal Contract

> Owner Domain: `PO-JOUR-*`

## Scope

This contract governs ParentOS observation journaling, including the current text/photo/voice entry flow and the current closed-set AI tag suggestion flow.

Covered features from `feature-matrix.yaml`:

- `PO-FEAT-008` parent observation journal
- `PO-FEAT-012` Montessori observation guidance
- `PO-FEAT-020` voice observation capture
- `PO-FEAT-021` AI journal tagging

Governing fact sources:

- `tables/local-storage.yaml#journal_entries`
- `tables/local-storage.yaml#journal_tags`
- `tables/observation-framework.yaml`
- `tables/routes.yaml#/journal`

## PO-JOUR-001 Journal Entry Shape

Journal entries must round-trip the typed SQLite shape:

| Field | Type |
|---|---|
| `entryId` | `string` |
| `childId` | `string` |
| `contentType` | `text \| voice \| photo \| mixed` |
| `textContent` | `string \| null` |
| `voicePath` | `string \| null` |
| `photoPaths` | `string[] \| null` |
| `recordedAt` | `ISO 8601 datetime string` |
| `ageMonths` | `integer` |
| `observationMode` | `quick-capture \| focused-observation \| daily-reflection \| five-minute \| null` |
| `dimensionId` | `string \| null` |
| `selectedTags` | `string[] \| null` |
| `guidedAnswers` | `Record<string, string> \| null` |
| `observationDuration` | `integer \| null` |
| `keepsake` | `0 \| 1` |
| `recorderId` | `string \| null` |

JSON-backed arrays and objects must be serialized as TEXT and decoded through typed bridge helpers.

## PO-JOUR-002 Observation Framework Binding

When `dimensionId` is present, it must exist in `observation-framework.yaml`.

- `selectedTags` must come from the dimension's quick-tag catalog
- `guidedAnswers` keys must correspond to the selected observation prompts
- `observationMode` must remain within the spec-defined enum

Journal guidance is structured and table-backed. It must not expand into free-form observation theory.

## PO-JOUR-003 Recorder and Keepsake Semantics

`recorderId` and `keepsake` are first-class fields.

- `recorderId` may be `null` when no recorder profile is selected
- non-null `recorderId` must match one of the child's `recorderProfiles` when profiles exist
- `keepsake = 1` marks a journal entry for keepsake-focused filtering only; it does not create a separate storage path

## PO-JOUR-004 Content-Type Integrity

`contentType` must describe the actual stored payload.

- `text` requires `textContent`
- `voice` requires `voicePath`
- `photo` requires `photoPaths`
- `mixed` requires at least two populated content channels

The journal layer must not report success for entries that violate this typed shape.

## PO-JOUR-005 Tag Records

`journal_tags` are optional secondary annotations.

- each tag row must reference an existing `entryId`
- `domain` must align with a known ParentOS knowledge domain
- `source` is `manual` or `ai`

Journal save must not require AI tag generation to succeed.

## PO-JOUR-006 Voice Observation Input

Voice observation is a typed journal extension, not a separate storage path.

Inputs are:

- a current-child journal draft
- the same observation form fields used by text entries
- one local audio file captured by the app shell
- an optional typed transcript produced by the runtime STT path

Voice observation must obey these invariants:

- local audio stays app-local and must not be uploaded to arbitrary third-party endpoints
- STT may produce transcript text and optional runtime artifact metadata only
- STT must not append diagnosis, explanation, domain interpretation, or tag suggestions
- `contentType = voice` when a saved entry has `voicePath` and no persisted `textContent`
- `contentType = mixed` when a saved entry has `voicePath` plus persisted `textContent`
- a transcript derived from voice must not be saved as `contentType = text`

## PO-JOUR-007 Voice Observation Save Flow

Voice observation save is a two-stage typed flow:

1. capture a local audio draft
2. optionally request typed STT
3. let the parent confirm the transcript
4. persist the final journal entry as `voice` or `mixed`

The app must not:

- auto-save a background journal row before the parent confirms the draft
- backfill transcript text into an already-saved `voice` row as a hidden follow-up mutation
- silently convert a failed STT attempt into a fake transcript

When runtime STT is unavailable or fails, the parent may still save a `voice` entry with the audio file only.

## PO-JOUR-008 Fail-Close Behavior

The journal layer must fail closed when:

- a `dimensionId` has no matching observation-framework record
- stored JSON fields are malformed
- a content payload does not match `contentType`
- a recorder reference cannot be projected into the typed entry shape
- a voice transcript request returns missing or malformed typed `speechTranscribe` output
- runtime STT reports success without stable transcript text for a transcript-save path
- a journal AI tag suggestion returns malformed JSON
- a journal AI tag suggestion returns an unknown `dimensionId`
- a journal AI tag suggestion returns tags outside the selected dimension's quick-tag vocabulary

## PO-JOUR-009 Closed-Set AI Tag Suggestion

`PO-FEAT-021` is a narrow extraction surface, not free-form observation analysis.

Inputs are:

- the current unsaved text draft or a parent-confirmed voice transcript
- one or more candidate observation dimensions from `observation-framework.yaml`
- the current child context already available inside the journal surface

Outputs are limited to typed structured data:

- `dimensionId: string | null`
- `tags: string[]`

The AI tagging path must obey these invariants:

- runtime route must remain `local`
- output must be JSON-only and match the typed shape above
- `dimensionId` must be chosen from the provided candidate dimensions
- `tags` must be a subset of that dimension's `quickTags`
- `domain` is fixed to `observation` for persistence and must not be inferred dynamically
- the tagging path must not emit diagnosis, theory explanation, parenting advice, or open-vocabulary labels

## PO-JOUR-010 Parent Confirmation and Persistence

AI tag suggestions remain advisory until the parent confirms save.

- the journal UI may auto-trigger tag suggestion after an unsaved draft stabilizes
- the UI may apply the suggested dimension and tags into the current draft for review
- the final persisted `selectedTags` payload must reflect the parent's current confirmed tag selection
- confirmed AI tags may also be persisted into `journal_tags` with `domain = observation` and `source = ai`
- AI tag rows must be written in the same typed save path as the journal entry when they are present
- the app must not mutate an already-saved journal row later to backfill AI tags

## Exclusions

The following remain outside this contract:

- free-form theory synthesis from `observation` while that domain remains `needs-review`
- any open-vocabulary domain classification or open-ended tag generation
- any observation narrative expansion, pattern analysis, or diagnostic summarization beyond the closed-set output defined in `PO-JOUR-009`

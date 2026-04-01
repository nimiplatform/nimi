# Lookdev Spec

> Scope: standalone batch control-plane app for world-scoped portrait standardization, capture selection, generation, evaluation, and commit
> Normative Imports: `spec/platform/kernel/architecture-contract.md`, upstream Realm agent presentation truth, `nimi-mods/runtime/agent-capture/spec/agent-capture.md`

## 0. Document Positioning

Lookdev is a standalone app under `apps/lookdev/`.

It is not:

- a Desktop panel
- a mod
- a generic agent editor
- a direct producer of canonical agent identity

Lookdev is the control plane for batch character portrait production.

Its formal product responsibility is:

1. open one world-scoped `WorldStyleSession`
2. converge that session through operator-authored natural-language replies
3. use understanding-led dialogue rather than scripted questionnaire prompts
4. synthesize one `WorldStylePack` draft from the session
5. require explicit operator confirmation before that style pack may drive downstream work
6. synthesize one app-local `CaptureState` per selected agent from creator-scoped Realm detail plus AgentRule-anchored truth and one confirmed world style pack, while preserving and using every readable agent field even when portrait truth is only partially available
7. materialize one reusable `PortraitBrief` per selected agent from that capture state
8. let the operator choose which agents enter `Capture Selection`
9. run focused interactive capture refinement only for the operator-selected subset, defaulting to `primary` agents
10. let the operator reset any interactive capture lane back to its current world-style-derived initial capture state and start that conversation over
11. keep non-capture-selected agents on a silent capture lane that still uses state-driven portrait synthesis rather than direct field concatenation
12. explicitly choose one batch-scope generation target and one batch-scope evaluation target from typed runtime availability
13. generate one current portrait result per batch item under one frozen shared policy
14. auto-evaluate each result against a conservative anchor-portrait gate
15. auto-retry failed items up to the retry budget
16. explicitly commit the passed set into Realm portrait truth
17. let the operator delete obsolete Lookdev-local batch records without mutating reusable working assets or rolling back Realm writeback

## 1. Core Boundary

Lookdev adopts a strict split between app-local working state and Realm truth.

- `WorldStylePack`, `CaptureState`, `PortraitBrief`, `LookdevBatch`, and `LookdevItem` are Lookdev-managed working objects
- these working objects may persist inside Lookdev and be reused across batches
- they are not Realm formal truth
- Realm receives only the explicitly committed formal portrait result

Realm truth intake for capture-state synthesis should prefer creator-scoped detail plus `AgentRule` truth over public browse-style projections.

- richer truth may strengthen role understanding, feeling anchors, and visual intent
- richer truth must still be mediated through `CaptureState`
- Lookdev must not bypass `CaptureState` and send raw Realm truth directly into batch image generation

Lookdev must not treat style packs, compiled briefs, generated images, or evaluation records as if they were already shared truth.

## 2. Relationship to Agent-Capture

Lookdev inherits visual capture direction from Agent-Capture, but not its product boundary.

- Agent-Capture remains a single-character exploratory drafting tool
- Lookdev remains the batch control plane
- Lookdev may reuse Agent-Capture's state-driven visual refinement method for both silent and interactive capture lanes
- the operator stays inside Lookdev; Lookdev does not require the user to switch products during its mainline flow

Lookdev therefore adds batch governance above Agent-Capture-style refinement:

- world-level style definition
- feeling-led world-style understanding dialogue
- per-agent capture-state synthesis
- per-agent brief materialization
- user-owned capture selection
- batch control
- item tracking
- auto-evaluation
- retry policy
- explicit batch commit into Realm

## 3. Target Output

The target output remains a character anchor image rather than a generic beauty shot.

Portrait generation should converge toward:

- full-body framing
- fixed-focal-length character framing
- stable subject clarity
- subdued background treatment
- downstream reusability for later character production

Lookdev is not a multi-candidate gacha selector by default. Each item owns one current result at a time.

## 4. Product Truth Units

Lookdev uses five app-local working objects:

- `WorldStyleSession`
- `WorldStylePack`
- `CaptureState`
- `PortraitBrief`
- `LookdevBatch`
- `LookdevItem`

The external formal writeback target remains the upstream Realm agent presentation portrait.

## 5. Formal Surfaces

The first formal app surfaces are:

- top shell with compact primary navigation
- route settings entry for runtime readiness plus dialogue / generation / evaluation route selection
- account identity remains in top-shell account chrome rather than inside route settings
- route settings persist across app restarts as app-local operator preferences
- batch list
- batch list latest activity signal
- create batch
- intake readiness state
- controllable world-only intake
- non-blocking intake truth diagnostics with explicit limited-truth warnings
- world style session
- world style pack draft synthesis
- world style pack confirmation
- silent capture-state synthesis
- focused interactive capture refinement
- interactive capture reset back to current-lane initial state
- app-local style-session / style-pack / capture / brief workspace restores for the same operator when Lookdev reopens
- route-settings-driven dialogue / generation / evaluation selection with create-page snapshot review
- portrait brief materialization from capture state
- capture selection
- batch detail
- frozen selection and policy snapshot visibility
- item list and item preview
- item queue, preview comparison, and diagnostics panes
- batch audit trail
- explicit delete-batch-record action for finished or paused local batches
- pause / resume
- rerun failed
- commit batch

Complex dashboards, per-item model override controls, and avatar-specific editing remain out of scope.

## 6. Non-Goals

- no direct rewrite of Realm agent truth beyond committed portrait output
- no default multi-candidate gallery per item
- no AI-owned authority over who enters capture
- no per-item model override inside one batch
- no automatic writeback immediately after auto-pass
- no default writeback to `AGENT_AVATAR`
- no reopening of a closed batch after `commit_complete`
- no cross-locale authoring drift where the shell locale changes but the active world-style lane or downstream capture working state silently keeps using the old language

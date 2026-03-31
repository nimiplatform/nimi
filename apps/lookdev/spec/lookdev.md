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
6. synthesize one app-local `CaptureState` per selected agent from creator-scoped Realm detail plus AgentRule-anchored truth and one confirmed world style pack
7. materialize one reusable `PortraitBrief` per selected agent from that capture state
8. let the operator choose which agents enter `Capture Selection`
9. run focused interactive capture refinement only for the operator-selected subset, defaulting to `primary` agents
10. keep non-capture-selected agents on a silent capture lane that still uses state-driven portrait synthesis rather than direct field concatenation
11. explicitly choose one batch-scope generation target and one batch-scope evaluation target from typed runtime availability
12. generate one current portrait result per batch item under one frozen shared policy
13. auto-evaluate each result against a conservative anchor-portrait gate
14. auto-retry failed items up to the retry budget
15. explicitly commit the passed set into Realm portrait truth

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

- batch list
- batch list latest activity signal
- create batch
- intake readiness state
- controllable world-only intake
- world style session
- world style pack draft synthesis
- world style pack confirmation
- silent capture-state synthesis
- focused interactive capture refinement
- explicit generation target selection
- explicit evaluation target selection
- portrait brief materialization from capture state
- capture selection
- batch detail
- frozen selection and policy snapshot visibility
- item list and item preview
- batch audit trail
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

# Lookdev Spec

> Scope: standalone batch control-plane app for generating, evaluating, and committing agent portrait results
> Normative Imports: `spec/platform/kernel/architecture-contract.md`, upstream Realm agent presentation truth, `nimi-mods/runtime/agent-capture/spec/agent-capture.md`

## 0. Document Positioning

Lookdev is a standalone app under `apps/lookdev/`.

It is not:

- a Desktop panel
- a mod
- a generic agent editor
- a direct producer of canonical agent identity

Lookdev is the batch control-plane app for agent visual look development.

Its first-version product responsibility is:

1. select a frozen set of Realm agents into one batch
2. generate one current portrait result per item under a shared batch policy
3. auto-evaluate each result against a conservative portrait gate
4. auto-retry failed items up to the batch retry limit
5. let the operator inspect batch progress and selectively rerun failed items
6. explicitly commit the passed set into Realm portrait truth

## 1. Core Boundary

Lookdev adopts a strict split between app-local working state and Realm truth.

- `LookdevBatch` and `LookdevItem` are app-local control-plane objects
- batch images, evaluation results, and retry records stay in Lookdev-managed storage until explicit commit
- Realm receives only the committed formal portrait result

Lookdev must not treat app-local batch data as if it were already Realm truth.

## 2. Relationship to Agent-Capture

Lookdev inherits generation direction from Agent-Capture, but not its product boundary.

- Agent-Capture is a single-user exploratory tool and prototype kernel
- Agent-Capture produces one current generated image and draft package in mod-local working state
- Lookdev reuses the same anchor-image intent, but operates as a batch app over many existing Realm agents

Lookdev therefore keeps the single-current-result discipline from Agent-Capture while adding:

- batch control
- item tracking
- auto-evaluation
- retry policy
- explicit batch commit into Realm

## 3. Target Output

The target output remains a character anchor image rather than a generic beauty shot.

First-version portrait generation should converge toward:

- full-body framing
- fixed-focal-length character framing
- stable subject clarity
- subdued background treatment
- downstream reusability for later character production

Lookdev is not a multi-candidate gacha selector by default. Each item owns one current result at a time.

## 4. Product Truth Units

Lookdev uses a two-level internal model:

- `LookdevBatch`: the top-level control and audit container
- `LookdevItem`: one Realm agent inside that batch

The external formal writeback target remains the upstream Realm agent presentation portrait.

## 5. First-Version Surfaces

The first visible app surfaces are:

- batch list
- create batch
- batch detail
- item list and item preview
- pause / resume
- rerun failed
- commit batch

Complex dashboards, per-item manual review workflows, and avatar-specific editing are out of scope.

## 6. Non-Goals

- no direct rewrite of Realm agent truth beyond committed portrait output
- no default multi-candidate gallery per item
- no per-item policy override inside one batch
- no automatic writeback immediately after auto-pass
- no default writeback to `AGENT_AVATAR`
- no reopening of a closed batch after `commit_complete`

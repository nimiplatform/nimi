# Projection Backpressure Smoothing Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: active. This contract admits renderer-local signal smoothing and
> the reusable Kit Avatar headless helper consumed by the launched Avatar
> carrier.
> **Upstream authority**: Runtime PresentationTimeline (`K-AGCORE-051`) remains
> the owner of activity, speech, lipsync timing, cancellation, and turn
> ordering truth.

---

## AV-PROJ-SMOOTH-001: Scope

Avatar may consume `@nimiplatform/kit/features/avatar` headless smoothing for
renderer-local `EmbodimentProjectionApi.setSignal` and
`EmbodimentProjectionApi.addSignal` writes before they reach a backend command
surface.

This is a renderer hot-path pressure valve only. It is not a Runtime event
ordering layer and must not define activity order, terminal state, voice timing,
lipsync timing, or generated motion truth.

## AV-PROJ-SMOOTH-002: Signal-Only Smoothing

The smoothing layer may:

- coalesce repeated `setSignal(signalId, value, weight)` calls so the latest
  value for one `signalId` wins before the next renderer flush
- accumulate repeated `addSignal(signalId, delta)` calls for one `signalId`
- expose read-your-write behavior for `getSignal(signalId)` while a signal
  write is pending
- bound pending signal memory and force a renderer flush when the bound is hit

The smoothing layer must pass through these methods without coalescing their
meaning:

- `triggerMotion`
- `stopMotion`
- `setExpression`
- `clearExpression`
- `setPose`
- `clearPose`
- `wait`
- `getSurfaceBounds`
- `runDefaultActivity`

Before any pass-through method above runs, pending signal writes must flush so
renderer-local parameter changes preserve local call order.

## AV-PROJ-SMOOTH-003: No Runtime Semantics

The smoothing layer must not:

- create a second Runtime presentation timeline
- reorder or suppress `RuntimeAgentConsumeEvent` records
- own activity, expression, motion, speech, or lipsync success evidence
- interpret external-entry provenance or consent
- emit Avatar package, Desktop launch, or SDK readiness truth

## AV-PROJ-SMOOTH-004: Lifecycle

The smoothing handle is created by the Avatar carrier through the Kit Avatar
headless helper after backend materialization and before NAS/event/interaction
consumers attach. It must be disposed when the runtime driver detaches or the
carrier shuts down.

Disposal must flush pending signal writes before the backend branch is shut
down.

## AV-PROJ-SMOOTH-005: Verification

The guard `pnpm check:avatar-projection-no-cue-semantics` must prove:

- the contract exists and cites `K-AGCORE-051`
- implementation is limited to renderer-local signal writes, even when the
  helper lives under Kit Avatar headless
- motion/expression/pose/default activity methods are pass-through after a
  pending signal flush
- voice/lipsync modules are not part of the smoothing implementation
- no Avatar-local Runtime event scheduling surface is introduced

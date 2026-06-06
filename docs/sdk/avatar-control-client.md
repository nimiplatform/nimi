# Avatar Control Client

## Status: Admitted, in build-out

The runtime avatar control client contract is admitted at the SDK
kernel level. The contract pins how an SDK consumer may control
avatar state from outside the Avatar carrier; the client surface is
in active build-out.

## What This Client Does

The Avatar Control Client is the SDK surface for an app that wants
to drive avatar state — request an activity, set an emotion, push a
presentation update — through admitted runtime projection. It is
**not** a way to reach into Live2D / VRM directly; backend execution
remains inside Avatar.

## Boundary

| Owns | Does NOT own |
| --- | --- |
| Typed runtime-side avatar control surface | Live2D / VRM execution |
| Authorization through admitted runtime projection | Per-frame parameter writes |
| Anchor-scoped activity / emotion / presentation requests | Renderer-local interpolation |

The SDK call goes through Runtime; Runtime emits the typed
`runtime.agent.presentation.*` projection event; Avatar consumes
the projection. The SDK does not bypass that chain.

## Reader Scenario: An App Triggers An Avatar Wave

An app wants the user's agent to wave when a milestone happens.

1. **App calls SDK.** `controlClient.requestActivity(activityId: 'wave',
   anchor)`.
2. **SDK validates.** Activity id is in admitted activity ontology;
   anchor is valid.
3. **Runtime processes.** Emits
   `runtime.agent.presentation.activity_requested` event.
4. **Avatar consumes.** Projection routes through the active backend
   branch; wave plays.
5. **Audit lineage.** Activity request is attributed to the app via
   admitted scoped binding.

## Reader Scenario: An App Pushes A Presentation Update

App wants to set the agent's expression for a UI moment.

1. **App calls SDK.** `controlClient.requestExpression('happy', anchor)`.
2. **Runtime emits.** `presentation.expression_requested` event.
3. **Avatar consumes.** Backend renders.
4. **Anchor scope honored.** The change applies to the anchor's
   stream; not as a global agent state without admitted scope.

## What This Client Does Not Do

- It does not bypass the `runtime.agent.*` projection.
- It does not write Live2D / VRM parameters directly.
- It does not invent activity / emotion / pose ids outside the
  admitted ontology.
- It does not allow control without an admitted anchor.

## Source Basis

- [`.nimi/spec/sdks/kernel/runtime-avatar-control-client-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/runtime-avatar-control-client-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)

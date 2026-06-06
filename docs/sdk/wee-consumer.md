# WEE Consumer

## Status: Admitted as platform direction

The SDK WEE consumer contract is admitted at the kernel level. The
runnable consumer surface is admitted as direction.

## What This Consumer Is

The SDK WEE Consumer is the surface for an app that wants to **drive**
WEE state — submit event proposals, request typed stage transitions,
participate in commit-request staging — through the admitted
runtime-side WEE engine.

Reading WEE state is [WEE Projection](/sdk/wee-projection)'s role;
driving is here.

## Authority Posture

| Owns | Does NOT own |
| --- | --- |
| Typed event-proposal submission API | WEE stage execution semantics (Runtime) |
| Typed commit-request observation | Realm commit envelope authority (Realm) |
| Consumer-facing reader scenario shape | Runtime-local execution evidence semantics |

The consumer submits; runtime executes; Realm admits. The consumer
does not invent stages or skip the runtime engine.

## Reader Scenario: App Submits A World Event Proposal

App wants to propose a typed world event on user action.

1. **App calls SDK.** `weeConsumer.submitProposal({ eventType, payload,
   anchor })`.
2. **Runtime ingest.** WEE `INGRESS` stage receives the proposal.
3. **Runtime stages.** NORMALIZE → SCHEDULE → DISPATCH → TRANSITION
   → EFFECT → COMMIT_REQUEST.
4. **Realm admits or rejects.** Per `R-WSTATE-005` authorization
   matrix.
5. **App observes outcome.** Through WEE projection.

## What This Does Not Do

- It does not let consumers skip WEE stages.
- It does not bypass Realm commit envelope.
- It does not let consumers invent `effectClass` values.
- It does not promote consumer payloads to Realm canonical truth
  outside the admitted commit pipeline.

## Source Basis

- [`.nimi/spec/sdks/kernel/world-evolution-engine-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/world-evolution-engine-consumer-contract.md)
- [`.nimi/spec/runtime/kernel/world-evolution-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/world-evolution-engine-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)

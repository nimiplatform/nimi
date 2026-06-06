# WEE Projection

## Status: Admitted as platform direction

The SDK WEE projection contract is admitted at the kernel level.
The runnable projection surface is admitted as direction; the
runtime-side WEE engine itself is also admitted as platform
direction (see [WEE Execution](/platform/worlds/wee-execution)).

## What This Projection Is

The SDK WEE Projection surface lets an app **read** WEE state — the
World Evolution Engine's runtime-local execution evidence projected
into typed shapes the app can consume. Reading is the role of this
surface; driving WEE is the role of [WEE Consumer](/sdk/wee-consumer).

## Authority Posture

| Owns | Does NOT own |
| --- | --- |
| Typed projection API for WEE state | WEE engine semantics (Runtime `K-WEV-*`) |
| Reader-friendly projected shapes | Realm canonical truth (Realm) |
| Anchor-scoped read surface | Runtime-local execution evidence definition |

WEE state is **runtime-local execution evidence**, not Realm
canonical truth. The projection makes that evidence consumable
without promoting it to Realm authority.

## Reader Scenario: An App Displays WEE Stage Progress

App wants to show the user that an event is moving through WEE
stages (NORMALIZE → SCHEDULE → DISPATCH → ...).

1. **App calls SDK.** `weeProjection.subscribeStage(eventId)`.
2. **SDK delivers typed stage events.** Each carries the typed
   stage transition.
3. **App displays.** "Event X is at stage TRANSITION."
4. **No Realm truth claim.** The projection is execution evidence;
   it does not project itself as canonical happened-fact.

## What This Does Not Do

- It does not let apps mutate WEE state.
- It does not promote runtime-local execution evidence to Realm
  truth.
- It does not invent stage names or transitions.

## Source Basis

- [`.nimi/spec/sdks/kernel/world-evolution-engine-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/world-evolution-engine-projection-contract.md)
- [`.nimi/spec/runtime/kernel/world-evolution-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/world-evolution-engine-contract.md)

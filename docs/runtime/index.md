# Runtime

Runtime is the layer that actually runs the AI work. It turns platform
intent into governed execution: providers, model catalogs, streaming,
workflows, local routing, delegation, audit, multimodal output, and
runtime-owned agent participation.

Apps shouldn't treat Runtime like a grab-bag of private functions. It has
a public contract surface and clear owner boundaries. The recommended way
for app code to use it is through the SDK — see
[SDK Boundaries](/sdk/boundaries) for the rules.

## What This Section Contains

- [Workflows And Multimodal](/runtime/workflows-and-multimodal) — how
  multi-step AI work and non-text artifacts are governed.
- [Providers And Models](/runtime/providers-and-models) — what the
  current public posture says about provider and model availability.

The cross-cutting [Errors And Compatibility](/reference/errors-and-compatibility)
page collects how Runtime errors surface to apps.

## What Runtime Owns

Runtime owns execution behavior that needs to be consistent across
product surfaces:

- request and streaming semantics;
- workflow lifecycle and node execution;
- provider and model catalog governance;
- local capability and device profile routing;
- connector and configuration rules;
- audit, replay, and failure semantics;
- delegated capability gateways and the delegated output firewall;
- runtime-owned agent participation, presentation, and memory substrate
  boundaries.

These responsibilities are documented as separate kernel contracts under
`K-*` rule families. Each contract has its own dedicated page in the
spec; the runtime kernel index lists them.

## What Runtime Does Not Own

Runtime doesn't own Realm truth, Desktop UI decisions, Web release
posture, or Cognition authority. It can bridge or consume those domains
when contracts allow it, but it can't redefine them.

That distinction matters when something goes wrong. If a Realm read
returns unexpected truth, the fix is in Realm, not in a runtime
workaround. If a Desktop surface displays state incorrectly, the fix is
in Desktop, not in a runtime patch.

## Reader Scenario: A Streaming Generation

Suppose an app calls Runtime to generate a streaming completion in a
world's context. Following the runtime workflow contract, the request
has a defined lifecycle:

1. The request is admitted as a `ScenarioJob` and moves into the
   `SUBMITTED` state.
2. The corresponding `Workflow` enters `ACCEPTED` once its DAG is
   prepared.
3. Streamed chunks arrive at the app under the streaming contract.
   Stage boundaries, terminal frames, and error semantics are all
   defined.
4. If a multimodal artifact is produced (image, audio, video, music,
   voice), it travels under the multimodal artifact contract instead
   of as an ad-hoc URL.
5. The workflow reaches `COMPLETED`, and audit records are written.

If anything in that lifecycle is wrong, Runtime is the owner. The app
does not shadow-fix it by creating its own streaming semantics; it
reports the failure under the Runtime error model.

## Reader Scenario: A Local Capability Route

Suppose a Desktop user has a local model and wants to use it for a
particular kind of work. Runtime decides which engine to route to using
the local capability and device profile contracts:

1. The local capability registry knows which categories the user has
   admitted on the device.
2. The device profile says what the device can support.
3. The local engine catalog tells Runtime which engine implements the
   route.
4. The local adapter routing determines the final adapter.

That entire decision is Runtime-owned. Desktop doesn't bypass it. The
app does not bypass it either.

## Provider And Model Posture

The docs describe provider and model governance at the contract level.
They don't publish a public availability catalog until admitted runtime
catalog evidence exists. See
[Providers And Models](/runtime/providers-and-models) for the current
posture and what a future public catalog must answer.

## Source Basis

- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/rpc-surface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/rpc-surface.md)
- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/multimodal-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/multimodal-provider-contract.md)
- [`.nimi/spec/runtime/kernel/delivery-gates-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delivery-gates-contract.md)
- [`.nimi/spec/runtime/kernel/model-catalog-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/model-catalog-contract.md)
- [`.nimi/spec/runtime/kernel/provider-health-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/provider-health-contract.md)
- [`.nimi/spec/runtime/kernel/local-category-capability.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-category-capability.md)
- [`.nimi/spec/runtime/kernel/device-profile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/device-profile-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)

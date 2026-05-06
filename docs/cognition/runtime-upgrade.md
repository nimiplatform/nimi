# Runtime Upgrade

The runtime upgrade contract describes how capability upgrades
flow between Runtime and Cognition without authority absorption.
A capability upgrade is when Cognition's surface offers more or
stronger semantics than Runtime's equivalent surface; the upgrade
contract maps the relationship.

## Why "Upgrade" Instead Of "Absorb"

If Cognition simply replaced Runtime's memory and knowledge
surfaces, two things would break:

- Existing apps consuming Runtime would have to re-bind to
  Cognition.
- Runtime's bank scope model (specific to runtime execution
  context) would dilute.

With an upgrade contract:

- Runtime and Cognition both keep their own surfaces.
- The upgrade matrix maps each runtime concern to a cognition
  surface with **parity or upgrade strength**.
- Apps that want richer semantics opt in via the bridge;
  apps that don't keep using Runtime directly.

## The Upgrade Matrix

`runtime-capability-upgrade-matrix.yaml` admits the per-concern
mapping.

| Runtime concern | Cognition surface | Strength |
| --- | --- | --- |
| Memory recall | Cognition Memory Service | Parity or richer |
| Knowledge query | Cognition Knowledge Service | Richer (first-class relations) |
| Prompt assembly | Cognition Prompt Service | Richer (lane separation) |
| Skill bundles | Cognition Skill Service | Adds typed advisory bundles |

The matrix is admitted; the strength claim is per-concern.

## What The Upgrade Does Not Do

| Concern | Why not |
| --- | --- |
| Replace Runtime as authority | Runtime keeps its canonical truth for bank scopes |
| Absorb Runtime memory bank scopes | Bank scopes are runtime concerns |
| Force apps to migrate | Bridge is opt-in |
| Demote Runtime contracts | Runtime contracts stay admitted |

The upgrade is **additive**, not replacive.

## Reader Scenario: An App Opts Into Cognition

A host product decides its agent should use Cognition for
memory and knowledge instead of just runtime banks.

1. **Wire the bridge.** Through admitted setup, runtime
   consumes cognition.
2. **Replication / projection.** Memory writes flow into
   cognition memory substrate via admitted projection.
3. **Reads through bridge.** Runtime queries cognition (richer
   surface).
4. **Existing runtime contracts unchanged.** Apps that did not
   know about cognition still see runtime as before.

The host product upgraded; the platform did not.

## Reader Scenario: Standalone Cognition Adoption

A project uses `nimi-cognition` without `nimi-runtime`.

1. **Adopt cognition.** Project depends on `nimi-cognition`.
2. **No upgrade matrix needed.** Project is using cognition
   directly; there is no runtime concern to upgrade from.
3. **Cognition standalone.** Project gets cognition's full
   surface without runtime bridge.

Standalone use bypasses the upgrade matrix entirely. The matrix
exists for projects that consume both runtime and cognition.

## Reader Scenario: Capability Drift

Suppose Cognition's knowledge service evolves (new operation
added). Does runtime see it?

1. **Cognition kernel admits new operation.** Per cognition's
   own admission contracts.
2. **Bridge contract evaluates.** If runtime should expose the
   new operation, the upgrade matrix admits it on the runtime
   side too.
3. **If admitted into upgrade matrix.** Runtime's
   `RuntimeCognitionService` exposes the new operation under
   admitted surface.
4. **If not admitted into upgrade matrix.** The new operation
   stays cognition-side only.

The matrix is the gating layer. Cognition can evolve without
forcibly extending runtime; runtime extends only when admitted.

## Reader Scenario: An Auditor Asks "Where Is The Memory Authority"

An auditor wants to know where canonical memory truth lives in a
project that uses both runtime and cognition.

| Scope | Authority |
| --- | --- |
| Runtime bank scope (`AGENT_CORE`, `AGENT_DYADIC`, `WORLD_SHARED`) | Runtime |
| Cognition memory substrate | Cognition |
| Cross-projection | Bridge contract maps |

An auditor reading the spec gets typed answers. Authority is not
ambiguous because the bridge is admitted, not improvised.

## Source Basis

- [`.nimi/spec/cognition/kernel/runtime-upgrade-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-upgrade-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
- [`.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/knowledge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/knowledge-contract.md)

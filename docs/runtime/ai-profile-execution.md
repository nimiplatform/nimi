# AI Profile Execution

## Status: Admitted, in build-out

The runtime contract for `AIProfile` execution
(`K-AIEXEC-001..K-AIEXEC-005`) is admitted at the kernel level. The
projection from desktop-portable `AIProfile` to local profile
descriptors is shipped as the spec boundary; probe + snapshot UI is
in active build-out.

## What This Page Covers

`AIProfile` is the **desktop-portable AI configuration package**
(see `D-AIPC-002`). It is not directly equivalent to a
`LocalProfileDescriptor` (`K-LOCAL-014a`). This page covers how
runtime executes the local-side projection — probes, snapshots,
resolution, and the `AIScopeRef` link.

## Authority Boundary

| Responsibility | Owner |
| --- | --- |
| `AIProfile` portable schema definition + validation | Desktop kernel (`D-AIPC-002`) |
| Portable → local descriptor projection | Scope owner / SDK |
| `LocalProfileDescriptor` execution + install | Runtime (`K-LOCAL-013..015`) |
| Device profile collection | Runtime (`K-DEV-001..009`) |
| Local asset resolution + health | Runtime (`K-LOCAL-014a`) |
| Execution snapshot evidence | Runtime (`K-AIEXEC-003`) |

The runtime is **not** a portable schema validator. It accepts and
executes `LocalProfileDescriptor`s; the scope-owner / SDK projection
is what turns a portable `AIProfile` into descriptors.

## Probe Contract

Probes split into three tiers (matching `D-AIPC-012`):

| Tier | Where executed | What it answers |
| --- | --- | --- |
| Static schema probe | Scope owner / SDK locally | Is the `AIProfile` portable schema valid? |
| Runtime availability probe | Runtime via `runtime.route.checkHealth` / `runtime.route.describe` | Is the route's provider / engine available? |
| Resource feasibility probe | Runtime via `CollectDeviceProfile` + `ResolveProfile` + `Peek` | Can this device run the profile? |

Static schema validation does not need a runtime RPC. The runtime is
not in that loop. Runtime availability probes reuse existing route
health surface; the runtime does not introduce a dedicated probe RPC.
Resource feasibility probes consume the existing scheduler and
resolver surface; `ResolveProfile` and `Peek` are not interchangeable.

## Execution Snapshot Contract

For every `ExecuteScenario` / `StreamScenario` / `SubmitScenarioJob`,
the runtime must fix the following evidence in the execution context:

| Evidence | Source |
| --- | --- |
| Caller-supplied route binding evidence | provider / model / connector / endpoint |
| Resolved effective capability | Runtime resolution result |
| Device resource snapshot | Scheduler occupancy + optional device profile summary |
| Scheduling preflight judgement | Optional; from `Peek` (`K-SCHED-002`) before `Acquire` |

Once written, evidence cannot be overwritten by later config changes.
It writes into audit trail (`K-AUDIT-001`).

The `schedulingJudgement` written to the snapshot must correspond to
the **submit-specific** capability / target. It is **not** a stand-in
for scope-level aggregate probe results. If the caller has only a
scope-aggregate judgement and no submit-target judgement, the
snapshot's `schedulingJudgement` must be `null` — the runtime does
not promote scope aggregate to submit evidence.

## Relationship To Desktop `AISnapshot`

| Surface | Role |
| --- | --- |
| Desktop `AISnapshot.runtimeEvidence` | Consumes runtime execution evidence |
| Desktop `ConversationExecutionSnapshot` (`D-LLM-019`) | Records app-facing execution evidence |
| `AISnapshot.runtimeEvidence.schedulingJudgement` (`D-AIPC-004`) | Submit-specific execution target judgement only |

The runtime does not perceive the desktop's `AISnapshot` or
`AIConfig` schema. It provides execution evidence data; that data
does not transfer snapshot ownership to the runtime.

For app consumers, the app-facing `AISnapshot` record / read owner
remains the scope owner. The SDK binds execution to the canonical app
`scopeRef` (see [AI Scope Identity](/platform/ai-scope-identity)) and
records the snapshot projection. The runtime does not perceive
consumer-local snapshot models.

## Reader Scenario: An App Workspace Executes Under An AI Profile

1. **Profile applied.** The scope owner projects the portable `AIProfile`
   into a `LocalProfileDescriptor` for this device.
2. **Scope identity.** The app workspace's
   `AIScopeRef{ kind: 'app', ownerId: <app id>, surfaceId: 'workspace' }`
   keys the snapshot.
3. **Execution call.** `SubmitScenarioJob` (or equivalent) goes
   through with the resolved descriptor.
4. **Execution snapshot.** Runtime fixes the four evidence rows in
   the execution context.
5. **Audit trail.** Evidence writes through `K-AUDIT-001`.
6. **App `AISnapshot.runtimeEvidence`.** The scope owner reads the
   evidence into its app-facing snapshot model.

## Reader Scenario: A Resource Feasibility Probe

1. **Caller initiates probe.** Wants to know if this device can run
   the profile under current load.
2. **Device profile.** Runtime calls `CollectDeviceProfile`.
3. **Plan + warnings.** Runtime calls `ResolveProfile` for execution
   plan + warnings.
4. **Scheduling preflight.** Runtime calls scheduler `Peek` for
   dynamic concurrency / scheduling judgement.
5. **Aggregate judgement.** Caller receives feasibility for the
   target it actually intends to submit; the aggregate judgement is
   not promoted to submit truth.

## Reader Scenario: Scope vs Submit Judgement

A caller has a scope-aggregate judgement (e.g., "this profile is
broadly feasible on this device under current scheduler load") but
no submit-specific judgement.

1. **Caller submits.** No submit-specific `Peek` call was made.
2. **Snapshot written.** Runtime sets
   `executionSnapshot.schedulingJudgement = null`.
3. **No promotion.** The scope aggregate is not silently promoted
   to submit-target judgement in the snapshot.
4. **Audit reflects truth.** Reviewers see "no submit-specific
   judgement was recorded for this submit."

The contract is strict because aggregate-vs-submit conflation hides
when scheduling preflight actually ran.

## What AI Profile Execution Does Not Do

- It does not validate `AIProfile` portable schema (Desktop does).
- It does not introduce a new probe RPC for runtime availability
  (existing health surface is reused).
- It does not let scope aggregate judgement substitute for submit
  judgement in execution snapshot.
- It does not own desktop or app snapshot schemas.
- It does not silently overwrite execution evidence after later
  config changes.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| `AIProfile` portable schema | Desktop kernel (`D-AIPC-002`) |
| Portable → local projection | Desktop / SDK |
| `LocalProfileDescriptor` execution | Runtime (`K-LOCAL-013..015`) |
| Probe tiers | Mixed (static = desktop; availability = runtime route health; feasibility = runtime device + resolver + scheduler) |
| Execution snapshot evidence | Runtime (`K-AIEXEC-003`) |
| `AIScopeRef` identity | Platform (`P-AISC-*`) |

## Source Basis

- [`.nimi/spec/runtime/kernel/ai-profile-execution-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/ai-profile-execution-contract.md)
- [`.nimi/spec/platform/kernel/ai-scope-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-scope-contract.md)

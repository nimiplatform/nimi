# Agent Participation Client

## Status: Admitted, in build-out

The runtime agent participation client contract
(`runtime-agent-participation-client-contract.md`) is admitted at the
SDK kernel level. The methods registry + behavioral checks are
shipped at the contract level; client-side fluent surface is in
active build-out.

## What This Client Does

The Agent Participation Client is the SDK surface for app /mod
developers who want their app to participate in agent execution under
an admitted participation profile (see
[Platform → Agents → Participation Authority](/platform/agents/participation-authority)).

It is **not** a way to invent new participation profiles. The closed
profile set lives in runtime spec; the SDK lets you submit against
admitted profiles.

## Method Surface

The methods registry lives in
`tables/runtime-agent-participation-methods.yaml`. The SDK surface
exposes the admitted methods as typed calls.

| Method family | Purpose |
| --- | --- |
| Profile attach | Attach an agent under an admitted participation profile |
| Output candidate submission | Submit a non-canonical output candidate |
| Promotion request | Request typed promotion of a candidate per `promotion_posture` |
| Profile detach | Cleanly detach |

## Behavioral Checks

`tables/sdk-runtime-behavioral-checks.yaml` admits behavioral
checks the SDK enforces before submission:

| Check | Purpose |
| --- | --- |
| Profile axes shape | Reject open-string axis values |
| Memory write default | Refuse `WRITE_NONE` profiles requesting durable writes |
| Capability scope | Refuse calls outside the profile's `capability_scope` |
| Output destination | Refuse outputs to non-admitted destinations |

These are SDK-side guards. Runtime still validates server-side; SDK
simply fails fast on detectable violations.

## Reader Scenario: Mod Submits An Output Candidate

A mod wants its agent to participate in a Realm group thread.

1. **Profile attach.** SDK call attaches the agent under
   `realm_group_participation`.
2. **Output candidate.** Mod assembles a typed message candidate;
   submits via SDK.
3. **SDK behavioral check.** Output destination
   `REALM_GROUP_MESSAGE_CANDIDATE` matches the profile.
4. **Runtime validates.** Server-side participation contract enforces.
5. **Realm slot binding.** Realm validates the agent slot binding
   before message commits.

## What This Client Does Not Do

- It does not invent new participation profiles.
- It does not bypass `WRITE_NONE` defaults.
- It does not route around the canonical chat budget for non-canonical
  profiles.
- It does not let SDK-side checks substitute for runtime validation.

## Source Basis

- [`.nimi/spec/sdk/kernel/runtime-agent-participation-client-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/runtime-agent-participation-client-contract.md)
- [`.nimi/spec/sdk/kernel/tables/runtime-agent-participation-methods.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/runtime-agent-participation-methods.yaml)
- [`.nimi/spec/sdk/kernel/tables/sdk-runtime-behavioral-checks.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/sdk-runtime-behavioral-checks.yaml)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)

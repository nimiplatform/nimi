# Agent Participation Client

## Status: Contract-Only; No Public SDK Method Today

The runtime agent participation contract
(`runtime-agent-participation-contract.md`) is admitted as a
semantic-contract-only boundary. The methods registry and behavioral
checks document the intended shape, but proto stubs and a public
production participation SDK surface are deferred and not exposed.

## What This Client Does

The Agent Participation Client page describes the contract for
apps that may later participate in agent execution under an admitted
participation profile (see
[Platform → Agents → Participation Authority](/platform/agents/participation-authority)).

It is **not** a public production SDK surface today, and it is not a way
to invent new participation profiles. The closed profile set lives in
runtime spec; future SDK calls must submit against admitted profiles only
after the public SDK surface is implemented.

## Method Surface

The methods registry lives in
`tables/runtime-agent-participation-methods.yaml`. It is contract
evidence, not public production callable SDK surface.

| Method family | Purpose |
| --- | --- |
| Profile attach | Attach an agent under an admitted participation profile |
| Output candidate submission | Submit a non-canonical output candidate |
| Promotion request | Request typed promotion of a candidate per `promotion_posture` |
| Profile detach | Cleanly detach |

## Behavioral Checks

The participation contract admits behavioral checks the SDK enforces before
submission:

| Check | Purpose |
| --- | --- |
| Profile axes shape | Reject open-string axis values |
| Memory write default | Refuse `WRITE_NONE` profiles requesting durable writes |
| Capability scope | Refuse calls outside the profile's `capability_scope` |
| Output destination | Refuse outputs to non-admitted destinations |

These are planned SDK-side guards. Runtime still validates server-side;
until the public client exists, callers must receive unavailable or
unsupported behavior rather than a success response.

## Reader Scenario: Future App Submits An Output Candidate

This is a future contract-only scenario, not a current public production
SDK promise. An app wants its agent to participate in a Realm group
thread after the deferred participation SDK is implemented.

1. **Profile attach.** SDK call attaches the agent under
   `realm_group_participation`.
2. **Output candidate.** The app assembles a typed message candidate;
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

- [`.nimi/spec/sdks/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/sdks/kernel/tables/runtime-agent-participation-methods.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/tables/runtime-agent-participation-methods.yaml)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)

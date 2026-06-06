# SDK Runtime Agent Participation Client Contract

> Owner Domain: `S-RUNTIME-*`

The SDK consumes Runtime Agent Participation authority as typed clients and
projections. It does not own participation execution semantics, prompt
assembly, provider/model routing, memory promotion, Realm GROUP commit,
cross-profile concurrency, audit truth, or protocol-native MCP/A2A wire truth.

## S-RUNTIME-211 Participation Client Boundary

SDK may expose Runtime Agent Participation APIs only as typed clients for
Runtime-owned `K-AGCORE-061` through `K-AGCORE-088` contracts.

SDK methods submit typed participation requests, read typed profile/context
metadata, observe Runtime-owned output candidates, and read Runtime audit/replay
views. SDK must not construct participation prompts, select AI providers or
models, decide memory/capability/concurrency verdicts, or commit domain
transcripts.

## S-RUNTIME-212 Axis and Profile Projection

SDK participation profile projection must align exactly to the closed axis and
profile registries in:

- `.nimi/spec/runtime/kernel/tables/agent-participation-axis-model.yaml`
- `.nimi/spec/runtime/kernel/tables/agent-participation-profiles.yaml`

SDK must not add open-string axis values, local lane enums, extra named
profiles, or compatibility aliases outside the Runtime registry.

## S-RUNTIME-213 Context Block Projection

SDK context block projection must align to
`.nimi/spec/runtime/kernel/tables/agent-participation-context-blocks.yaml`.

SDK consumers may pass typed context block references admitted by Runtime, but
they must not pass raw prompt blobs, raw transcript dumps, raw protocol payloads,
or untyped provider/app-local memory payloads.

## S-RUNTIME-214 Output Candidate Projection

SDK output candidate projection must align to
`.nimi/spec/runtime/kernel/tables/agent-participation-output-destinations.yaml`.

SDK must distinguish Runtime execution output from domain transcript commit. For
Realm GROUP participation, SDK may expose a Runtime-owned non-committal
candidate and a Realm-authenticated commit path owned by `R-CHAT-*`; SDK must
not expose Runtime direct GROUP write as a participation helper.

## S-RUNTIME-215 Verdict Projection

SDK memory, capability, promotion, and concurrency verdict projection must align
to:

- `.nimi/spec/runtime/kernel/tables/agent-participation-memory-policy.yaml`
- `.nimi/spec/runtime/kernel/tables/agent-participation-memory-read-scopes.yaml`
- `.nimi/spec/runtime/kernel/tables/agent-participation-capability-scopes.yaml`
- `.nimi/spec/runtime/kernel/tables/agent-participation-concurrency-policy.yaml`

SDK must expose verdicts as typed Runtime decisions. SDK must not infer private
memory read access, canonical capability carryover, canonical memory write, or
cross-profile admission locally.

## S-RUNTIME-216 Audit and Replay Projection

SDK participation audit/replay projection must layer on existing Runtime audit
authority:

- `K-AUDIT-001` through `K-AUDIT-022`
- `K-AGCORE-087`
- `K-DELEG-085` and `K-DELEG-086` where delegated gateway evidence participates

SDK may expose typed audit and replay views, but it must preserve redaction,
access control, invalid-lineage failure states, and the absence of any
participation-specific side audit store.

## S-RUNTIME-217 Participation Method Registry

SDK participation method names, categories, source rules, and input/output
references are governed by
`.nimi/spec/sdks/kernel/tables/runtime-agent-participation-methods.yaml`.

The table is the SDK method-family registry for implementation admission. It
does not by itself claim production availability. A method family becomes
public-production only when SDK implementation/generation, admitted transport,
and owner tests bind the registry entry. Missing implementation must fail
closed as unavailable and must not be advertised as active support.

## S-RUNTIME-218 Type Escape Prohibition

Participation SDK public types must use named interfaces, enums, tagged unions,
or schema-bound references. Stable SDK participation contracts must not use:

- `any`
- `Record<string, unknown>`
- free-form maps
- raw prompt blobs
- raw MCP/A2A payloads
- raw provider payloads
- raw memory payloads

Runtime-internal `systemPrompt` parameters are implementation details and do not
become SDK public API.

## S-RUNTIME-219 Consumer No-Bypass

SDK must not provide helper APIs that let Desktop, Web, Avatar, or apps
bypass Runtime participation authority with direct provider calls, direct model
selection, direct Realm GROUP AI write, raw prompt assembly, or direct
MCP/A2A client creation.

All participation execution must route through Runtime-owned authority and all
domain commits must remain under their domain owners.

## S-RUNTIME-220 Implementation And Consumer Availability Boundary

This contract admits the SDK typed contract and method registry only. SDK
implementation methods, generated client code, proto stubs, Desktop surfaces,
Avatar surfaces, app integrations, OASIS consumers, Scenario consumers,
A2A production entry, and MCP production entry are not implied by this
contract. Each surface requires its own admitted implementation and tests
before support is claimed.

Until those implementation gates exist, SDK must not claim production Runtime
Agent Participation support.

## Traceability

`S-RUNTIME-211` through `S-RUNTIME-220` define one SDK projection family for
Runtime Agent Participation. The family is intentionally typed-client-only:
SDK consumes `K-AGCORE-061` through `K-AGCORE-088` and existing Runtime audit /
delegation / Realm commit authority without re-owning them.

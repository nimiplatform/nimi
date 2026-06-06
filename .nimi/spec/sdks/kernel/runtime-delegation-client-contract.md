# SDK Runtime Delegation Client Contract

> Owner Domain: `S-RUNTIME-*`

The SDK consumes Runtime Delegated Capability Gateway state as typed
projections and command envelopes. It does not own Runtime delegation
semantics, approval policy, provider lifecycle, credentials, firewall verdicts,
or audit truth.

## S-RUNTIME-201 Delegation Client Boundary

SDK may expose Runtime delegation APIs only as typed clients for Runtime-owned
contracts:

- External Agent gateway/status/token/action/audit projection
- provider profile projection
- provider lifecycle projection
- delegated session projection
- delegated request projection
- delegated result projection
- firewall verdict projection
- approval request and decision projection
- audit/replay projection

SDK must not expose protocol-native MCP or A2A wire objects as stable public
Nimi types.

## S-RUNTIME-202 Provider Projection

Provider projection fields must align to `K-DELEG-002` through `K-DELEG-007`.

SDK may expose display and status fields, but it must not expose raw connector
credentials, authorization headers, provider secret material, or adapter-local
handles.

## S-RUNTIME-203 Delegation Request Projection

Delegation session projection must align to `K-DELEG-020` through
`K-DELEG-021`. Delegation request projection must align to `K-DELEG-030`
through `K-DELEG-032`.

SDK consumers may observe request state and submit Runtime-owned commands. They
must not mutate request internals by local object replacement.

External Agent action descriptors, issue/revoke/list token operations,
execution context verification, completion, and audit replay are Runtime-owned
commands/projections. SDK may expose typed methods for them; it must not
preserve Desktop/Tauri command names or retired extension-specific identity
fields.

## S-RUNTIME-204 Delegation Result Projection

Delegation result projection must align to `K-DELEG-040` through `K-DELEG-046`.

SDK must distinguish provider completion from firewall acceptance. A completed
provider result is not accepted Runtime context until a firewall verdict exists.

## S-RUNTIME-205 Firewall Projection

Firewall projection must align to `K-DELEG-050` through `K-DELEG-084`.

SDK must expose verdict, reason, confidence, provenance, and quarantine state
as typed fields. It must not expose raw quarantined payload by default.

## S-RUNTIME-206 Approval Projection

Approval projection must align to `K-DELEG-090` through `K-DELEG-099`.

SDK approval methods submit typed Runtime decisions. They do not own approval
policy and cannot auto-approve outside Runtime policy.

## S-RUNTIME-207 Audit Replay Projection

Audit and replay projection must align to `K-DELEG-085` through `K-DELEG-089`
and `K-AUDIT-*`.

SDK may expose replay views, but it must preserve redaction, access control,
and invalid-lineage failure states.

## S-RUNTIME-208 Type Escape Prohibition

Delegation SDK types must use named interfaces, enums, tagged unions, or
schema-bound references. Stable SDK delegation contracts must not use untyped
catch-all fields for provider output, protocol metadata, or adapter-specific
payloads.

Protocol evidence may be represented only by typed evidence refs and
protocol metadata fields admitted by `K-DELEG-044`.

## S-RUNTIME-209 Consumer No-Bypass

SDK must not provide helper APIs that connect Desktop, Avatar, apps, Web, or
direct consumers directly to MCP/A2A providers. All delegated operations must route through
Runtime-owned gateway APIs.

## S-RUNTIME-210 Implementation And Consumer Availability Boundary

This contract admits the SDK typed delegation contract only. SDK
implementation methods, generated clients, Desktop/Avatar/app consumers,
provider configuration UX, approval UX, and replay UX require their own
admitted implementation and tests before support is claimed. Until those gates
exist, SDK may not claim production delegated provider configuration,
approval, or replay support.

## Traceability

`S-RUNTIME-201` through `S-RUNTIME-210` define one SDK projection family for
Runtime delegation. The family is a typed contract surface:
`S-RUNTIME-201`, `S-RUNTIME-202`, `S-RUNTIME-203`, `S-RUNTIME-204`,
`S-RUNTIME-205`, `S-RUNTIME-206`, `S-RUNTIME-207`, `S-RUNTIME-208`,
`S-RUNTIME-209`, and `S-RUNTIME-210` must be consumed by later SDK
implementation admissions without re-owning Runtime delegation semantics.

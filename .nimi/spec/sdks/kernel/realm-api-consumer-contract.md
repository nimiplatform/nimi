# SDK Realm API Consumer Contract

> Owner Domain: `S-REALMAPI-*`

## Scope

Nimi consumes Realm as an external API authority identified by `<nimi-realm>`.
This contract governs SDK, Runtime, Desktop, Web, and app consumption of Realm
API projections. It does not define Realm server truth, Realm domain semantics,
or Realm product authority.

Realm canonical authority lives outside this repository. The nested
`.nimi/spec/realm/**` subtree is an external pointer only and must not contain
Realm kernel contracts, tables, generated docs, or domain authority mirrors.

## S-REALMAPI-001 External Authority Boundary

`MUST`: Realm domain authority is external to Nimi and is identified as
`<nimi-realm>`.

`MUST NOT`: Nimi specs, SDK docs, Runtime, Desktop, Web, or apps must not
re-declare Realm server/domain rules as local authority.

Nimi-owned contracts may reference Realm only as an external dependency, a
generated API input, or a consumer projection boundary.

## S-REALMAPI-002 Generated API Is The Consumer Floor

`MUST`: Stable Realm API consumption must start from the generated Realm SDK
core sourced from the configured Realm OpenAPI input.

`MUST NOT`: Consumers must not bypass generated Realm clients with app-local
REST helpers, hand-authored endpoint strings, global OpenAPI singleton
mutation, or duplicated response-shape declarations.

Handwritten SDK facades are allowed only when they wrap generated operations
with typed fail-closed behavior and do not restore a second Realm contract.

## S-REALMAPI-003 SDK Owns Consumer Semantics Only

SDK may own:

- endpoint/token instance isolation
- request transport configuration
- typed error projection
- retry and refresh orchestration
- generated client composition
- consumer availability and fail-closed states

SDK must not own:

- Realm canonical records or lifecycle truth
- Realm auth/session issuance semantics
- Realm social/chat/economy/domain invariants
- Realm OpenAPI source authority
- server compatibility promises outside the generated API input

## S-REALMAPI-004 Runtime/Desktop Projection Boundary

Runtime and Desktop may consume Realm projections through SDK-owned typed
facades, but local Runtime/Desktop state must not become Realm canonical truth.

When a local projection cannot be reconciled with Realm API output, the
consumer must fail closed or expose an explicit unavailable/error projection.
It must not synthesize Realm success.

## S-REALMAPI-005 Version Drift Handling

`MUST`: Realm API drift is handled by regenerating the SDK core from the
configured Realm OpenAPI input and updating SDK consumer contracts/tests.

`MUST NOT`: Nimi must not patch drift by copying Realm spec text into
`.nimi/spec/realm/**`, freezing stale DTOs in handwritten clients, or adding
compatibility aliases that hide server contract changes.

## S-REALMAPI-006 Pointer-Only Realm Subtree

The only admitted files under `.nimi/spec/realm/**` are pointer/navigation
files that identify `<nimi-realm>` and route readers to SDK consumer contracts.

Forbidden under `.nimi/spec/realm/**`:

- `kernel/**`
- `kernel/tables/**`
- generated Realm docs
- Realm domain guides that restate product rules
- delegated projection mirrors from `<nimi-realm>`

## Traceability

- `.nimi/spec/sdks/kernel/realm-core-contract.md`
- `.nimi/spec/sdks/kernel/realm-contract.md`
- `.nimi/spec/sdks/kernel/boundary-contract.md`
- `sdks/typescript/core-generated/realm-client.ts`
- `sdks/typescript/core-generated/realm-typed-client.ts`

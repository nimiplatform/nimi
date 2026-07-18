# SDK Realm API Consumer Contract

> Owner Domain: `S-REALMAPI-*`

## Scope

Nimi consumes Realm as an external API authority identified by the external Realm authority.
This contract governs SDK, Runtime, Desktop, Web, and app consumption of Realm
API projections. It does not define Realm server truth, Realm domain semantics,
or Realm product authority.

Realm canonical authority lives outside this repository. The nested
`.nimi/spec/realm/**` subtree is an external pointer only and must not contain
Realm kernel contracts, tables, generated docs, or domain authority mirrors.

## S-REALMAPI-001 External Authority Boundary

`MUST`: Realm domain authority is external to Nimi and is identified as
the external Realm authority.

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

Source materialization uses only the generated current Realm Packet v3 and
`CharacterSourceRefV3` transport shapes. The generated operation families own
the authenticated first-party challenge, packet, ordered closure-set segment,
component, hash-graph, current-JWKS, and detached-proof shapes. Source
materialization has no app permission or grant carrier. SDK and apps must not
introduce a handwritten materialization DTO, anonymous source payload, fixed
audience, raw bundle DTO, or parallel packet decoder.

## S-REALMAPI-003 SDK Owns Consumer Semantics Only

SDK may own:

- endpoint/token instance isolation
- request transport configuration
- typed error projection
- retry and refresh orchestration
- generated client composition
- consumer availability and fail-closed states
- current small Realm readiness and source-record reads
- high-level authenticated Runtime `MaterializeRealmSource` intent carrying
  only `CharacterSourceRefV3` and `requestId`

SDK must not own:

- Realm canonical records or lifecycle truth
- Realm auth/session issuance semantics
- Realm social/chat/economy/domain invariants
- Realm OpenAPI source authority
- server compatibility promises outside the generated API input
- source-materialization packet, audience, proof, manifest, component, or
  world-closure shape semantics

## S-REALMAPI-004 Runtime/Desktop Projection Boundary

Runtime and Desktop may consume Realm projections through SDK-owned typed
facades, but local Runtime/Desktop state must not become Realm canonical truth.

When a local projection cannot be reconciled with Realm API output, the
consumer must fail closed or expose an explicit unavailable/error projection.
It must not synthesize Realm success.

Desktop, Kit, and Web submit only `CharacterSourceRefV3` and `requestId` to the
high-level authenticated Runtime `MaterializeRealmSource` operation. Runtime
internally resolves the current account, canonical Realm base, bearer, fresh
challenge, Packet v3 response, and current JWKS. Realm applies its first-party
source visibility/readiness policy directly; there is no app grant. No app-facing
facade may receive or persist packet/proof/segment/component bytes, choose an
audience, decode closure truth into app-owned records, or accept an unknown
schema, field, enum, segment kind, limit, or hash branch as local success.

## S-REALMAPI-005 Version Drift Handling

`MUST`: Realm API drift is handled by regenerating the SDK core from the
configured Realm OpenAPI input and updating SDK consumer contracts/tests.

`MUST NOT`: Nimi must not patch drift by copying Realm spec text into
`.nimi/spec/realm/**`, freezing stale DTOs in handwritten clients, or adding
compatibility aliases that hide server contract changes.

An unknown Packet v3/challenge schema, field, enum, proof family, component or
segment kind, limit, hash edge, or closure branch is version drift and fails
closed until the configured Realm OpenAPI input is regenerated. Handwritten
compatibility readers are forbidden.

## S-REALMAPI-006 Pointer-Only Realm Subtree

The only admitted files under `.nimi/spec/realm/**` are pointer/navigation
files that identify the external Realm authority and route readers to SDK consumer contracts.

Forbidden under `.nimi/spec/realm/**`:

- `kernel/**`
- `kernel/tables/**`
- generated Realm docs
- Realm domain guides that restate product rules
- delegated projection mirrors from the external Realm authority

## Traceability

- `.nimi/spec/sdks/kernel/realm-core-contract.md`
- `.nimi/spec/sdks/kernel/realm-contract.md`
- `.nimi/spec/sdks/kernel/boundary-contract.md`
- `sdks/typescript/core-generated/realm-client.ts`
- `sdks/typescript/core-generated/realm-typed-client.ts`

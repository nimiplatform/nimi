# SDKS Realm Core Contract

Status: active product authority.

## S-REALMCORE-001 Realm Generated Core Source

Realm generated core under `sdks/**/core-generated` is sourced from the
configured Realm OpenAPI input from the external Realm authority.
`.nimi/spec/sdks/**` owns the SDK-family projection boundary; old `sdk/`
facade contracts and `.nimi/spec/realm/**` mirrors must not be used as
generated Realm authority.

Nimi admits exactly two generated projections from that input: the public SDK
core under `sdks/**/core-generated` (or the language-equivalent directory), and
the Runtime-private carrier under `runtime/gen/realm/v1` required because the
Runtime import boundary forbids importing `sdks/**`. The same generator run
must emit and drift-check both projections. There is no third projection.

Together these generated carriers own the Nimi wire-shape projection for the
current Realm `CharacterSourceRefV3`, Packet v3 closure set, eight packet
limits, authenticated first-party challenges, current JWKS, ordered segments,
hash graph, and detached-proof carriers. Packet issuance and current-JWKS acquisition are consumed only by
Runtime's private `RealmMaterializationIssuer`, according to
`tables/realm-private-operation-carriers.yaml`; no handwritten core, facade,
app, or public Runtime adapter may own a parallel materialization request DTO
or transport path. Runtime-private streaming verification state remains
Runtime enforcement semantics and must stay generated-field-closure-gated as
required by `S-REALMAPI-002`.

## S-REALMCORE-002 Realm Facade Boundary

TypeScript may expose a handwritten Realm facade over generated Realm core.
The facade must fail closed on malformed operation boundaries and must not
restore global OpenAPI singleton configuration.

The facade may validate, route, retry, and correlate current small Realm reads.
It must not expose packet issuance, challenge, bearer, grant selection, raw
packet/proof/segment/component bytes, or Packet v3 decoding to SDK, Kit,
Desktop, or Web callers. Those callers submit only `CharacterSourceRefV3` and
`requestId` through the authenticated Runtime `MaterializeRealmSource` facade;
Runtime alone acquires and verifies the generated Packet v3 transport.

The generated language manifests prove schema/operation shape convergence.
They do not by themselves prove that every language exposes or can execute
every operation. Runtime-private operations must not be projected as public SDK
methods; language behavior claims require an executable conformance path that
returns normally or a typed error, never `panic`, trap, or process abort.

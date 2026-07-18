# SDKS Realm Core Contract

Status: active product authority.

## S-REALMCORE-001 Realm Generated Core Source

Realm generated core under `sdks/**/core-generated` is sourced from the
configured Realm OpenAPI input from the external Realm authority.
`.nimi/spec/sdks/**` owns the SDK-family projection boundary; old `sdk/`
facade contracts and `.nimi/spec/realm/**` mirrors must not be used as
generated Realm authority.

The generated core is the only Nimi wire-shape projection for the current Realm
`CharacterSourceRefV3`, Packet v3 closure set, eight packet limits,
authenticated first-party challenges, current JWKS, ordered segments, hash
graph, and detached-proof carriers. Packet issuance is consumed only by Runtime's private
`RealmMaterializationIssuer`; no handwritten core, facade, app, or public
Runtime adapter may own a parallel materialization DTO, decoder, or transport
path.

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

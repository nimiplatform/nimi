# SDKS Realm Core Contract

Status: active product authority.

## S-REALMCORE-001 Realm Generated Core Source

Realm generated core under `sdks/**/core-generated` is sourced from the
configured Realm OpenAPI input from the external Realm authority.
`.nimi/spec/sdks/**` owns the SDK-family projection boundary; old `sdk/`
facade contracts and `.nimi/spec/realm/**` mirrors must not be used as
generated Realm authority.

The generated core is the only Nimi shape owner for Realm source
materialization packet-v2 and challenge transport, including typed source,
World dependency closure, manifest/component hashes, and detached proof
carriers. No handwritten core, facade, app, or Runtime adapter may own a packet
v1, anonymous/raw payload, fixed-audience, or parallel materialization shape.

## S-REALMCORE-002 Realm Facade Boundary

TypeScript may expose a handwritten Realm facade over generated Realm core.
The facade must fail closed on malformed operation boundaries and must not
restore global OpenAPI singleton configuration.

The facade may validate, route, retry, and correlate generated operations. It
must preserve the opaque Runtime-issued challenge/audience and generated
packet-v2 carriers exactly; it must not reinterpret packet semantics, author
proof or closure data, or expose raw bundle DTOs as SDK-owned truth.

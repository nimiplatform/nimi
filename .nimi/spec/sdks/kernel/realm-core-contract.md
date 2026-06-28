# SDKS Realm Core Contract

Status: active product authority.

## S-REALMCORE-001 Realm Generated Core Source

Realm generated core under `sdks/**/core-generated` is sourced from the
configured Realm OpenAPI input from the external Realm authority.
`.nimi/spec/sdks/**` owns the SDK-family projection boundary; old `sdk/`
facade contracts and `.nimi/spec/realm/**` mirrors must not be used as
generated Realm authority.

## S-REALMCORE-002 Realm Facade Boundary

TypeScript may expose a handwritten Realm facade over generated Realm core.
The facade must fail closed on malformed operation boundaries and must not
restore global OpenAPI singleton configuration.

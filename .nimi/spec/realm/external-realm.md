# External Realm Authority

## External Authority

This file records the external Realm authority pointer for Nimi.

`<nimi-realm>` owns Realm server truth, Realm domain semantics, Realm OpenAPI
generation, and Realm API compatibility promises.

Realm server/domain product rules are not redefined in this repository.

## Nimi Consumer Boundary

Nimi owns only consumer behavior:

- SDK generated Realm core and typed facade behavior
- Runtime/Desktop use of the Realm SDK
- typed rejection handling for auth, transport, schema, and domain errors
- local projection boundaries outside Realm canonical truth

The 0K local-app principal, record, local grant, process/session and selected
RuntimeAgent/Cognition access decision are Nimi local authority. A Realm grant
is neither a prerequisite nor a substitute for that local decision. When a
selected operation independently consumes Realm-owned data, Runtime still uses
the canonical Realm consumer path and Realm policy; it never exports bearer
material or mirrors Realm grant truth into the local-app stores.

No Realm server/domain definitions, forks, or mirrors are part of this pointer
under `.nimi/spec/realm/**`.

## Canonical Nimi Reading Path

1. `.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`
2. `.nimi/spec/sdks/kernel/realm-core-contract.md`
3. `.nimi/spec/sdks/kernel/realm-contract.md`
4. `.nimi/spec/runtime/**` and `.nimi/spec/desktop/**` consumer contracts
   that use Realm projections

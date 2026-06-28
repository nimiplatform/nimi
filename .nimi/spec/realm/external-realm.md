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
- fail-closed handling of auth, transport, schema, and domain errors
- local projection boundaries that must not become Realm canonical truth

Nimi must not define, fork, or mirror Realm server/domain authority under
`.nimi/spec/realm/**`.

## Canonical Nimi Reading Path

1. `.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`
2. `.nimi/spec/sdks/kernel/realm-core-contract.md`
3. `.nimi/spec/sdks/kernel/realm-contract.md`
4. `.nimi/spec/runtime/**` and `.nimi/spec/desktop/**` consumer contracts
   that use Realm projections

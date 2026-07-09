# External Realm Authority

## External Authority

This file records the external Realm authority pointer for Nimi.

Realm server/domain product rules are not redefined in this repository.

## Nimi Consumer Boundary

Nimi consumer behavior is documented in the SDK and downstream consumer
contracts listed below.

- SDK generated Realm core and typed facade behavior
- Runtime/Desktop use of the Realm SDK
- auth, transport, schema, and domain error handling
- local projection boundaries

## Canonical Nimi Reading Path

1. `.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`
2. `.nimi/spec/sdks/kernel/realm-core-contract.md`
3. `.nimi/spec/sdks/kernel/realm-contract.md`
4. `.nimi/spec/runtime/**` and `.nimi/spec/desktop/**` consumer contracts
   that use Realm projections

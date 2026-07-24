# External Realm Authority

## External Authority

This file records the external Realm authority pointer for Nimi.

`<external-realm-authority>` owns Realm server truth, Realm domain semantics, Realm OpenAPI
generation, and Realm API compatibility promises.

Realm server/domain product rules are not redefined in this repository.

## Nimi Consumer Boundary

Nimi owns only consumer behavior:

- SDK generated Realm core and typed facade behavior
- Runtime/Desktop use of the Realm SDK
- typed rejection handling for auth, transport, schema, and domain errors
- local projection boundaries outside Realm canonical truth

The 0K local-app principal, record, process/session, base entitlements and any
future Runtime-owned public-permission decision are Nimi local authority.
Realm-owned data operations and Realm-owned permission decisions remain subject
to canonical Realm account/resource policy; Runtime never exports bearer
material or mirrors Realm policy decisions into a local decision store.

No Realm server/domain definitions, forks, or mirrors are part of this pointer
under `.nimi/spec/realm/**`.

Source materialization is the external Realm authenticated first-party product
operation defined by Realm policy v5, not an App permission. Runtime sends no
app id, permission scope or access grant, and the retired Realm scope names are
never projected into the Nimi app registry or a local permission store. The local
`agents.interact` permission begins only after Runtime has strictly verified
the Realm Packet and atomically materialized an opaque LocalAgent.

## Canonical Nimi Reading Path

1. `.nimi/spec/canonical/sdks/realm-consumer.authority.yaml`
2. `docs/authority/sdks-realm-consumer-rationale.md` (retired contract prose archive)
4. `.nimi/spec/runtime/**` and `.nimi/spec/desktop/**` consumer contracts
   that use Realm projections

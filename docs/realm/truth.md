# Realm Truth Boundary

Realm truth is owned by the external Realm authority. This repository
does not define Realm server records, world lifecycle rules, social/economy
invariants, or Realm domain semantics.

Nimi consumes Realm through SDK-owned generated clients and typed facades. That
means app code should treat Realm facts as API output from the configured Realm
service, not as local Nimi spec truth.

## What Nimi Owns

| Nimi surface | Responsibility |
| --- | --- |
| SDK generated Realm core | Typed client shape generated from the configured Realm OpenAPI input |
| SDK Realm facade | Consumer transport, token handling, fail-closed errors, and typed wrappers |
| Runtime/Desktop/Web/apps | Consumer projections through the SDK boundary |

## What Nimi Does Not Own

- Realm canonical records.
- Realm social, chat, economy, asset, binding, transit, or world rules.
- Realm auth/session issuance truth.
- New local Realm kernel contract files in this repository.

If an app needs Realm data, it should use the SDK Realm client or an app-owned
wrapper over that client. It should not copy Realm endpoint strings, duplicate
response shapes, or treat old local Realm spec mirrors as authority.

## Source Basis

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)

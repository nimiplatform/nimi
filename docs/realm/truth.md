# Realm Truth Boundary

Realm, the external service, decides what is true about worlds: the records,
the world lifecycle rules, the social and economic invariants. This repository
defines none of those.

Nimi reaches Realm through generated SDK clients with typed wrappers around
them. For app code, that means a Realm fact is data returned by the Realm
service you are connected to — never something Nimi defines locally.

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

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)

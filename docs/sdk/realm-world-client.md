# Realm Access from an App

Realm owns account, Character, World, social, economy, history, and asset truth. A Nimi App consumes the admitted `client.realm` operations on its host-bound client. Runtime mediates authorized Realm access without giving the App a Realm token or raw REST/WebSocket transport.

## Typed Owner Operations

Use only the operations exposed for the App's current declaration and access. The protected carrier derives the account and App subject. PersonaCharacter owner operations, World surfaces, and Realm realtime each keep their own typed input, authorization, and result contract; a generic arbitrary-path proxy is not admitted.

The direct `@nimiplatform/sdk/realm` facade remains a separate SDK surface for consumers that own an admitted Realm session. It is not a way for a formal Nimi App to escape its host-bound access. The removed `@nimiplatform/sdk/world` subpath remains absent.

## Compose a Product Flow

1. Read the needed Realm information through an admitted App operation.
2. Use `client.ai` for App AI work, or the separately authorized Agent operation for Agent work.
3. Keep project workflow and result adoption in the App.
4. If the user requests a Realm mutation, submit it through its admitted Realm owner operation and display that actual result.

Local execution, a cached projection, or an App success message cannot commit Realm truth. A missing carrier or denied operation fails explicitly; do not replace it with raw `/api/...` calls.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)

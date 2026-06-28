# Realm And Composition

This page is the reader's view of Realm truth consumption and world-facing
composition through SDK vNext. The old `@nimiplatform/sdk/world` subpath is not
part of the public surface. World-facing workflows use the SDK root
composition surface, Realm helpers, and admitted feature modules.

## What Realm Owns

Realm owns semantic truth: accounts, profiles, social data, world state, world
history, assets, and app-visible Realm records. The SDK exposes app-facing
typed access without letting apps call Realm private internals or raw REST
routes.

Apps should use:

- `client.realm` from `@nimiplatform/sdk`;
- `@nimiplatform/sdk/realm` for direct Realm facade consumption;
- generated Realm service boundaries where the facade exposes them.

## World-Facing Composition

World workflows often need Realm truth plus Runtime execution. In vNext this is
not a separate `world` package root. The composition belongs on:

- the SDK root client when the workflow crosses Runtime and Realm;
- `@nimiplatform/sdk/realm` when the app reads admitted Realm truth;
- `@nimiplatform/sdk/features/workflow` when the workflow helper is an admitted
  feature-level developer experience.

The composition must keep authority visible. Realm still owns truth. Runtime
still owns execution. SDK helpers do not become a third source of truth.

## Reader Scenario: Read State, Then Run Agent Work

1. The app reads world state through `client.realm` or
   `@nimiplatform/sdk/realm`.
2. The app runs AI or workflow work through `client.runtime`,
   `@nimiplatform/sdk/runtime`, `@nimiplatform/sdk/ai-runner`, or an admitted
   feature helper.
3. If execution changes Realm truth, the write lands through admitted Realm
   contracts. The app does not restate truth locally.
4. The app re-reads Realm state through the SDK.

## What This Surface Does Not Do

- It does not restore `@nimiplatform/sdk/world`.
- It does not allow raw `/api/...` Realm REST calls in app code.
- It does not promote Runtime-local execution evidence to Realm truth.
- It does not let feature helpers own Runtime RPC parity or Realm semantics.

## Source Basis

- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/world-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/world-contract.md)
- [`.nimi/spec/sdks/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/surface-contract.md)
- [`.nimi/spec/sdks/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/boundary-contract.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)

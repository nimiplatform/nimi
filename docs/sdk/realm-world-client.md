# Realm And Composition

This page is the reader's view of Realm truth consumption and world-facing
composition through SDK vNext. The old `@nimiplatform/sdk/world` subpath is not
part of the public surface. World-facing operations use the SDK root
composition surface and Realm helpers.

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

World-facing operations often need Realm truth plus Runtime execution. In vNext this is
not a separate `world` package root. The composition belongs on:

- the SDK root client when an operation crosses Runtime and Realm;
- `@nimiplatform/sdk/realm` when the app reads admitted Realm truth;

The composition must keep authority visible. Realm still owns truth. Runtime
still owns execution. SDK helpers do not become a third source of truth.

## Reader Scenario: Read State, Then Run Agent Work

1. The app reads world state through `client.realm` or
   `@nimiplatform/sdk/realm`.
2. The app runs AI work through `client.runtime`,
   `@nimiplatform/sdk/runtime`, or `@nimiplatform/sdk/ai-runner`.
3. If execution changes Realm truth, the write lands through admitted Realm
   contracts. The app does not restate truth locally.
4. The app re-reads Realm state through the SDK.

## What This Surface Does Not Do

- It does not restore `@nimiplatform/sdk/world`.
- It does not allow raw `/api/...` Realm REST calls in app code.
- It does not promote Runtime-local execution evidence to Realm truth.
- It does not let feature helpers own Runtime RPC parity or Realm semantics.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)

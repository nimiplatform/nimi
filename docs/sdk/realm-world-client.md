# Realm And World Client

Realm and world access in the SDK is about controlled composition. Apps
need to read and use world truth, but they should not become a second
Realm authority.

This page is the reader's view of `sdk/realm` and `sdk/world`. Authority
lives in the SDK kernel under `S-REALM-*` and `S-WORLD-*` and in the
Realm kernel.

## How Realm Access Works

Realm owns semantic truth, world state, world history, chat, and
related domain contracts. The SDK can expose a public facade for app
use, but it does not change where Realm truth lives.

For a reader, that means:

- The realm client lets apps read the world's truth surface that has
  been admitted as public.
- It doesn't expose backend, dashboard, or creator-side authority.
- It doesn't let apps write back to Realm in ways that would change
  truth without going through admitted Realm contracts.

## World Composition

World APIs combine Realm truth with Runtime-backed generation or
materialization flows. That composition is useful for apps because a
world experience often needs both:

- a stable read of the world's current state and history (Realm), and
- a generative or interactive AI capability to act inside that state
  (Runtime).

The composition contract keeps the owner line visible. Realm remains
the truth owner. Runtime remains the execution owner. The world client
is the place where they meet, not a place where ownership blurs.

## Reader Scenario: Reading World State Then Asking The Agent To Act

Suppose an app wants to show a world view and then ask an agent to
take an action inside it:

1. The app uses `sdk/world` to read a typed view of the world state.
   Realm contracts (truth, world-state, world-history) are projected
   into a stable shape.
2. The app uses `sdk/runtime` to issue an agent action under
   runtime-owned agent participation. Runtime contracts govern
   execution.
3. The action's effect on world truth, if any, lands through admitted
   Realm contracts, not through the app re-stating world truth on its
   own.
4. The app re-reads world state through `sdk/world` to reflect the new
   truth. It doesn't maintain a private mirror that diverges from
   Realm.

The point of the split is that the app is the consumer of two
authorities, not the third authority itself.

## Reader Scenario: A World History Read

Suppose an app needs to display a world's history — past relationships,
past events, past transitions:

1. World history is owned by Realm under the world-history contract.
2. The SDK projects the history surface that is admitted as public.
3. The app reads that surface and renders it. The app does not invent
   its own canonical history list.

If the rendered history is wrong, the fix is in Realm or in the
projected surface, not in app logic that papers over Realm output.

## Active And Defined Surfaces

Some world composition surfaces are active and stable; some are
defined but not yet a complete public product. The SDK surface
contract distinguishes the two.

For a reader, the practical rule is to read the surface contract
before depending on a method, and to treat unmentioned methods as
not part of the contract.

## Source Basis

- [`.nimi/spec/sdk/realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/realm.md)
- [`.nimi/spec/sdk/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/world.md)
- [`.nimi/spec/sdk/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/realm-contract.md)
- [`.nimi/spec/sdk/kernel/world-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/world-contract.md)
- [`.nimi/spec/sdk/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/boundary-contract.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/index.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)

# Platform Architecture

Nimi is split into authority surfaces so that one layer does not silently
redefine another layer's truth. The public docs give you the cross-layer
map; the spec keeps the actual contracts precise.

This page is a reading aid for the architecture, not the architecture
itself. Rule-level authority lives in `.nimi/spec/platform/kernel/`.

## The High-Level Shape

At a high level, Nimi separates these responsibilities:

- **Platform** defines the world model, the six protocol primitives, and
  the authority rules that say who is allowed to redefine what.
- **Runtime** owns AI execution, workflows, streaming, model and provider
  governance, local capability routing, delegation, audit, and
  runtime-owned agent participation.
- **SDK** gives applications the official access boundary so that apps do
  not import private internals.
- **Realm** owns semantic truth, world state, world history, chat, and
  related domain contracts.
- **Desktop** hosts native first-party capabilities and shell-level
  workflows.
- **Web** exposes a constrained projection of selected surfaces in the
  browser.
- **Avatar** owns embodied agent presentation as its own domain.
- **Cognition** owns standalone memory, knowledge, prompt serving,
  references, completion, and runtime bridge semantics.

This structure keeps integration flexible without letting every package
become its own source of truth.

## Cross-Layer Communication

The platform spec freezes a small set of cross-layer relationships. Each
arrow below corresponds to an admitted contract surface:

```
desktop      ->  nimi-sdk         : unified developer surface
desktop      ->  nimi-runtime     : gRPC runtime access
nimi-apps    ->  Realm source authority       : REST + WS realm access
nimi-runtime <-> nimi-cognition   : runtime bridge / consume overlap
                                    (authority remains with cognition)
```

Two things follow from that diagram:

- Cognition is reachable through Runtime's bridge, but Runtime doesn't
  absorb Cognition's authority. The bridge is consumption, not ownership.
- Apps use the SDK boundary instead of importing Runtime or Realm
  internals directly.

## Reader Scenario: A Generation Request From An App

Suppose an app needs to ask Runtime to generate a streamed multimodal
response inside a world's context. The architecture says:

1. The app uses `@nimiplatform/sdk/runtime` or the root SDK client to issue
   the request. It doesn't import private runtime modules; the SDK is the
   boundary.
2. Runtime owns the workflow and the streaming lifecycle. It knows when
   the request is `ACCEPTED`, when streaming starts, when terminal
   frames are emitted, and when the workflow is `COMPLETED`.
3. If the app also needs to read world truth (for example, to know what
   participants are present), it uses `@nimiplatform/sdk/realm` or root-client
   Realm composition. It doesn't import Realm internals.
4. If the workflow needs memory, Runtime bridges to Cognition under the
   bridge contract. The app does not see Cognition's internals.
5. If the response includes a multimodal artifact, it travels under
   Runtime's artifact contract, not via an ad-hoc URL.

Every hop above is mediated by an admitted contract. The architecture
exists exactly so that these hops cannot be silently shortcutted.

## Public And Private Authority

The public repository documents the public platform, runtime, SDK,
desktop, web, avatar, cognition, and Nimi Coding surfaces. Private realm
or backend authority, dashboard authority, and creator-side authority
live in their own owner locations and are not silently absorbed into
these public docs.

That separation matters for readers. If a page explains Realm semantics,
it is explaining the public read path. It isn't exposing every backend
or creator control-plane contract.

## Why The SDK Matters

Apps should not reach directly across private Runtime or Realm internals.
The SDK is the public integration surface. It allows applications to
compose Runtime-backed generation, Realm truth reads, and scope flows
without importing private implementation boundaries.

When an app violates that boundary, two things break. First, the app
becomes coupled to internals that can change. Second, the app starts to
form its own local expectation of how Runtime or Realm behave; that
expectation can drift from the contract and become silent local truth.

## Source Basis

- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/platform/kernel/app-slice-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/app-slice-admission-contract.md)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdks/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/index.md)

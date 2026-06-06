# Runtime Client

The SDK runtime client is the public application path into Runtime
behavior. It should be used instead of direct imports from runtime
private code or app-specific bypasses.

The kernel rules backing this page live under `S-RUNTIME-*` and
`S-TRANSPORT-*`.

## What It Represents

The runtime client projects Runtime capabilities into a TypeScript
surface: transport, metadata, streaming behavior, errors, and grouped
runtime methods. It lets applications call Runtime in a way that follows
the same authority boundary as the rest of the platform.

That means an app written against `@nimiplatform/sdk/runtime` does not have to know
which package implements a runtime method, how the transport handles
retries, or how runtime audit is recorded. Those concerns are handled
by the SDK projection.

## What It Hides And What It Exposes

The runtime client deliberately hides:

- private transport implementation;
- internal error shapes that should not leak;
- private runtime helper utilities;
- raw transport retries and auth refresh, which are mechanism not
  contract rescue.

It deliberately exposes:

- typed runtime methods grouped by capability area (workflow,
  streaming, multimodal, delegation surfaces, agent participation
  projection);
- transport metadata that apps need to make sense of behavior;
- runtime error projections that apps can react to programmatically;
- streaming primitives that match the Runtime streaming contract.

## Why Direct Access Is Not The Model

Direct access creates two problems. First, it couples applications to
private Runtime internals. Second, it lets apps form local
expectations that may not match Runtime's source contracts. The SDK
boundary prevents both.

If a runtime capability seems to require a direct import to use, that
is a sign the SDK projection needs an additional admitted surface, not
a sign that the boundary should be bypassed.

## Reader Scenario: A Streaming Generation Through The Client

Suppose an app issues a streaming generation through `@nimiplatform/sdk/runtime`:

1. The app calls the runtime client's generation method with a typed
   request.
2. The client transports the request and surfaces a typed streaming
   primitive that matches the Runtime streaming contract.
3. The app consumes the streaming primitive without inventing its own
   chunk semantics. Stage boundaries, terminal frames, and error
   semantics come from the contract.
4. If the workflow produces a multimodal artifact, the artifact is
   surfaced through a typed shape, not as a free-form URL.
5. Errors arrive as typed projections defined in the SDK error
   projection. The app does not have to parse free-form messages.

That flow is what makes the app portable across Runtime internal
changes.

## Reader Scenario: When A Method Is Not Yet On The Client

Suppose Runtime has admitted a new capability in the kernel, but the
SDK projection has not been admitted yet. The app does not get to
synthesize the call from private internals. The right move is:

- Treat the absence as the contract.
- File or follow the work that admits the SDK surface.
- Wait for the projection.

That waiting feels slow. It is what keeps the SDK from accumulating
silent surfaces that nothing can vouch for.

## Source Basis

- [`.nimi/spec/sdks/kernel/runtime-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/runtime-contract.md)
- [`.nimi/spec/sdks/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/transport-contract.md)
- [`.nimi/spec/sdks/kernel/error-projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/error-projection.md)
- [`.nimi/spec/sdks/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/surface-contract.md)
- [`.nimi/spec/sdks/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/boundary-contract.md)
- [`.nimi/spec/sdks/kernel/runtime-route-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/runtime-route-contract.md)
- [`.nimi/spec/sdks/kernel/runtime-delegation-client-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/runtime-delegation-client-contract.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)

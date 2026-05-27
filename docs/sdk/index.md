# SDK

The Nimi SDK is the layer your app code actually talks to. It gives you a
supported path into Runtime, Realm, world semantics, AI providers, scope,
and shared types — without importing private internals from any of
those layers.

If you're building on Nimi, the SDK is the boundary to look for first.
Apps that stay inside it survive Runtime and Realm internal changes
without trouble. Apps that reach past it inherit every internal change as
a breaking change.

## What This Section Contains

- [Boundaries](/sdk/boundaries) — the import and call rules apps are
  expected to follow.
- [Runtime Client](/sdk/runtime-client) — the public app path into
  Runtime behavior.
- [Realm And World Client](/sdk/realm-world-client) — composition of
  Realm truth and Runtime-backed generation.

The cross-domain [Glossary](/reference/glossary) explains "surface,"
"boundary," and "projection" if those terms are unfamiliar.

## Why The SDK Exists

Nimi has multiple authority domains. Runtime owns execution. Realm owns
semantic truth. Desktop owns native shell behavior. Cognition owns
standalone memory and knowledge authority. Application code needs a
stable way to use those domains without becoming coupled to their
private implementation.

The SDK is that boundary. The boundary is admitted in the SDK kernel
under `S-BOUNDARY-*` and `S-SURFACE-*` rule families.

## Main Surfaces

The SDK is split into named sub-paths. Each one has its own surface
contract:

| Sub-path | What it represents |
| --- | --- |
| `runtime` | Runtime-backed calls and transport projection |
| `realm` | Public Realm facade and generated client boundary |
| `world` | Composition of world truth and Runtime-backed generation |
| `ai-provider` | AI provider projection through Runtime |
| `scope` | Authorization and catalog lifecycle projection |
| `types` | Shared public types |

Apps usually import from more than one sub-path. The point of the split
is that each sub-path can evolve under its own contract without
contaminating the others.

## Active And Defined Areas

The spec distinguishes active core surfaces from defined surfaces whose
API shape is still being completed. Public docs should not treat a
defined future surface as fully available until the implementation
evidence exists.

For a reader, the practical rule is: when a page calls a surface
"contract-level," the contract is admitted; when it calls a surface
"projection-only," the surface is shaped but the implementation is not
yet treated as a complete public product.

## Reader Scenario: A First Integration

Suppose you are writing an app that needs to call Runtime for a
generation, read world truth, and react to Realm updates:

1. You import from `sdk/runtime`. You issue a generation request and
   consume the streamed response under the streaming contract; see
   [Runtime Streaming](/runtime/streaming) for the streaming
   semantics and [Runtime Workflows](/runtime/workflows) for the
   request lifecycle.
2. You import from `sdk/realm` (or `sdk/world` if you need composed
   world reads) to read the world's truth. You do not import Realm
   internals; the SDK projects what your app is allowed to see.
3. You import from `sdk/scope` if your app needs authorization and
   catalog projection.
4. Shared types come from `sdk/types`. They are stable building blocks
   used across the other sub-paths.

The result is an app that does not import a single private path. When
Runtime or Realm internals evolve, your app keeps working as long as
the SDK contracts hold.

## Reader Scenario: A Boundary Violation Caught Early

Suppose during a refactor a developer thinks "I will just import this
helper from the runtime package directly; the SDK is fine but it is one
more layer." That import is exactly what the SDK boundary forbids.

Two things go wrong if the violation lands:

- The app's behavior is now coupled to runtime internals that can
  change.
- The app starts forming a local expectation of how runtime behaves
  that has no admitted contract.

Catching the violation in code review keeps the app integration
honest. The SDK kernel's import boundaries table is the canonical list
of what is and is not allowed.

## Source Basis

- [`.nimi/spec/sdk/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/index.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
- [`.nimi/spec/sdk/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/surface-contract.md)
- [`.nimi/spec/sdk/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/boundary-contract.md)
- [`.nimi/spec/sdk/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/transport-contract.md)
- [`.nimi/spec/sdk/kernel/error-projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/error-projection.md)
- [`.nimi/spec/sdk/kernel/runtime-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/runtime-contract.md)
- [`.nimi/spec/sdk/kernel/world-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/world-contract.md)
- [`.nimi/spec/sdk/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/realm-contract.md)
- [`.nimi/spec/sdk/kernel/ai-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/ai-provider-contract.md)
- [`.nimi/spec/sdk/kernel/scope-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/scope-contract.md)
- [`.nimi/spec/sdk/kernel/tables/sdk-surfaces.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/sdk-surfaces.yaml)
- [`.nimi/spec/sdk/kernel/tables/import-boundaries.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/import-boundaries.yaml)

# Shared Types

`@nimiplatform/sdk/types` carries the shared public types that
every other SDK sub-path uses. It is the small, stable building
block layer; nothing in the SDK that crosses sub-paths invents
its own type for what `types` already exports.

## What Lives Here

The types sub-path exports the cross-cutting symbols that consumers
need to talk about Nimi without importing private internals.

| Symbol | Purpose |
| --- | --- |
| `NimiError` | The typed error surface for SDK callers |
| `ScopeName` | Typed scope identifier |
| `ExternalPrincipalId` | Typed external principal identifier |
| Runtime ids | `WorldId`, `AgentId`, `ConversationId`, etc. |
| Workflow ids | `WorkflowId`, `JobId`, `NodeId` |
| Streaming primitives | Typed shapes for the four streaming modes |
| Multimodal primitives | `ArtifactId`, canonical artifact field types |

The exact set is admitted in the SDK kernel surface contract; new
types require kernel admission.

## Why Centralized Types Matter

Without shared types, each sub-path would re-declare its own
`AgentId`. Two `AgentId` types from two sub-paths might be
nominally compatible but structurally drift. A typed system
becomes weakly-typed by accident.

Centralizing in `@nimiplatform/sdk/types` keeps the same nominal type across
every public surface. An app that passes an `AgentId` from
`@nimiplatform/sdk/runtime` to a Realm or root-client workflow is passing the
same type, not a coincidentally-shaped twin.

## Boundary Rules

| Rule | Why |
| --- | --- |
| Other sub-paths do not redeclare types from `types` | Avoids drift |
| `types` does not import from other sub-paths | Stays at the bottom of the dependency graph |
| `types` does not depend on transport (`@nimiplatform/sdk/runtime`) or projection (`@nimiplatform/sdk/realm`) | Keeps types portable |
| New types require kernel admission | Same admission discipline as other surfaces |

## Reader Scenario: Passing An ID Between Sub-Paths

An app reads an agent id via `@nimiplatform/sdk/realm` and uses it to issue a
runtime call.

1. **Read.** `realm.agents.get(id)` returns an `Agent` whose
   `agent.id` is typed `AgentId` from `@nimiplatform/sdk/types`.
2. **Pass.** The app calls `runtime.agent.startConversation(id)`.
3. **Type compatibility.** Both sub-paths share the `AgentId`
   type from `@nimiplatform/sdk/types`. The compiler accepts the call.
4. **No silent coercion.** If the type were declared twice in
   different sub-paths, the compiler would either refuse or
   coerce silently. With centralized types, neither happens.

The app does not have to convert between two near-identical
types. The shared types layer is the structural fix.

## Reader Scenario: A Typed Error Reaches Application Code

A runtime call fails with a contract failure.

1. **Runtime emits typed error.** Through the SDK error
   projection, the error becomes a `NimiError` with reason code.
2. **App imports `NimiError`.** From `@nimiplatform/sdk/types`.
3. **Type-narrow.** The app pattern-matches on the reason code
   to decide UX behavior.

```ts
import { NimiError } from '@nimiplatform/sdk/types';

try {
  await runtime.workflow.run(...);
} catch (err) {
  if (err instanceof NimiError) {
    // typed reason code
    if (err.reasonCode === 'AUTH_TOKEN_EXPIRED') { ... }
    if (err.reasonCode === 'AUTH_UNSUPPORTED_PROOF_TYPE') { ... }
  }
}
```

The error is typed because it comes from `@nimiplatform/sdk/types`, not because
the app guessed. Pre-launch posture: exact reason-code list
admitted in the SDK kernel.

## Reader Scenario: Library Author Adding A Helper

A library author wants to write a helper that takes any Nimi
identifier.

1. **Import from `@nimiplatform/sdk/types`.** They depend on
   `@nimiplatform/sdk/types`, not on `@nimiplatform/sdk/runtime`
   or `@nimiplatform/sdk/realm`.
2. **Helper accepts `AgentId | WorldId | ConversationId`.** A
   typed union from `@nimiplatform/sdk/types`.
3. **Library compiles.** No transport dependency; no runtime
   pull; portable.

A library that depended on `@nimiplatform/sdk/runtime` for type information
would drag the entire transport layer into its consumers. Pulling
from `@nimiplatform/sdk/types` keeps the dependency graph thin.

## What Is Not In `types`

| Excluded | Why |
| --- | --- |
| Method functions | Those live in `@nimiplatform/sdk/runtime`, `@nimiplatform/sdk/realm`, etc. |
| Transport details (`connectorId`, gRPC metadata) | Layered, not in `types` |
| Provider names | Catalog data, not type system |
| World content (rules, agents, etc.) | Content, not types |

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`config/sdks-typescript-target-export-map.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/sdks-typescript-target-export-map.yaml)
- [`config/sdks-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/sdks-error-codes.yaml)

# AI Config Surface

The SDK AI Config surface is the typed boundary for app-owned AI capability
bindings. It answers one app developer question: "which Runtime target should
this capability use, and what happens if no live target is selected?"

Current code exposes AIConfig types, stores, profile helpers, target-ref
validation, scheduling helpers, and runtime-binding helpers through
`@nimiplatform/sdk` and `@nimiplatform/sdk/ai`. Kit consumes those primitives to
build reusable model-config UI.

## Current Public Pieces

| Piece | Public path | What it does |
| --- | --- | --- |
| AIConfig types and target refs | `@nimiplatform/sdk` or `@nimiplatform/sdk/ai` | `NimiAIConfig`, `NimiAIScopeRef`, `NimiAIConfigTargetRef`, profile and snapshot types |
| Scope helpers | `@nimiplatform/sdk/ai` | Create and validate `NimiAIScopeRef` values |
| Config store helpers | `@nimiplatform/sdk/ai` | App-owned storage adapters for AIConfig and snapshots |
| Runtime binding resolver | `@nimiplatform/sdk/ai` | Convert `NimiAIConfig` + capability id into model, route policy, target ref, metadata |
| Kit model-config surface | `@nimiplatform/kit/features/model-config/*` | Reusable UI and headless contracts for selecting/applying model bindings |

## Target Ref Families

| `targetRef.kind` | Meaning | Dispatch status |
| --- | --- | --- |
| `profile-slice` | A profile intent that has not been materialized into a live Runtime target | Not dispatchable |
| `local-runtime` | Runtime local target identity v2 with `profileBindingId` or `readinessRef` | Dispatchable when Runtime can resolve it |
| `cloud-connector` | Runtime cloud provider connector and remote model catalog identity | Dispatchable when provider connector is configured |

Runtime-backed `createRuntimeModel` and embedding clients fail closed when
`targetRef` is missing or still points to `profile-slice`.

## App Integration Flow

1. The app creates an explicit app scope, usually with
   `createNimiAppAIScopeRef(appId, surfaceId)`.
2. The app stores and loads `NimiAIConfig` through an app-owned AIConfig
   service.
3. The app uses Kit model-config UI or another admitted app flow to select or
   apply a Runtime target.
4. Before dispatch, the app calls `resolveNimiAIConfigRuntimeBinding(...)` for
   the capability it wants to run.
5. The app passes the resolved `model`, `routePolicy`, `connectorId`,
   `targetRef`, and metadata into SDK Runtime AI calls.

See [First AI Call](/sdk/first-ai-call) for the dispatch shape.

## Fail-Closed Binding Resolution

`resolveNimiAIConfigRuntimeBinding(...)` returns a typed failure instead of
fabricating a model:

| Reason | Meaning |
| --- | --- |
| `binding-capability-missing` | The app did not declare which AIConfig capability backs this route. |
| `target-ref-missing` | The capability has no selected target. |
| `profile-slice-unmaterialized` | The config still points to profile intent, not a live Runtime target. |
| `runtime-model-missing` | The target ref does not contain a runtime model id. |

Apps should surface these states as model setup or account/setup work. They
should not fall back to `auto`, a hardcoded provider, or app-local REST.

## What This Surface Does Not Own

- It does not own Runtime model readiness or execution evidence.
- It does not own Realm truth or app listing admission.
- It does not let apps invent scope kinds.
- It does not let apps bypass profile apply/materialization by writing
  arbitrary live target ids.
- It does not make CLI `nimi run` success equivalent to app AIConfig readiness.

## Source Basis

- [`.nimi/spec/sdks/kernel/ai-config-surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/ai-config-surface-contract.md)
- [`sdks/typescript/core/ai/config-types.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config-types.ts)
- [`sdks/typescript/core/ai/config-scope.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config-scope.ts)
- [`sdks/typescript/core/ai/config-runtime-binding.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config-runtime-binding.ts)
- [`sdks/typescript/core/ai/runtime-target-ref.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-target-ref.ts)
- [`kit/features/model-config/src`](https://github.com/nimiplatform/nimi/tree/main/kit/features/model-config/src)
- [`apps/tester/src/tester/tester-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-ai-config-store.ts)

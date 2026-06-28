# Troubleshooting Nimi App Integration

Use this page when a Nimi App, SDK call, Tester lane, or local Runtime command
fails before a generation completes. It focuses on failures a third-party app
author can act on from the public surfaces.

## First Check The Runtime

Run:

```sh
nimi doctor
```

If the daemon is not reachable, Runtime reports the same next step used by the
CLI onboarding path:

```sh
nimi start
```

or, when you need the daemon in the foreground:

```sh
nimi serve
```

Then verify the zero-config path:

```sh
nimi run "What is Nimi?"
```

For a cloud provider route, configure the provider before invoking it:

```sh
nimi provider set gemini --api-key-env GEMINI_API_KEY
nimi run "What is Nimi?" --provider gemini
```

## SDK Client Configuration

`SDK_CLIENT_APP_ID_REQUIRED` means the SDK operation needs a concrete app id.
Create the root client with `appId`, or pass `appId` into the specific Runtime
AI surface that requires it:

```ts
import { createNimiClient } from '@nimiplatform/sdk';

const nimi = createNimiClient({
  appId: 'my-nimi-app',
  runtime: {
    transport: {
      type: 'node-grpc',
      endpoint: process.env.NIMI_RUNTIME_GRPC_ENDPOINT || '127.0.0.1:46371',
    },
  },
});
```

The SDK throws this before dispatch. Do not work around it by calling Runtime
private endpoints from app code.

## Runtime AI Target Resolution

`resolve_runtime_target_ref_before_invocation` means the app attempted a
Runtime-backed AI call without a live Runtime target reference. Load the app's
AIConfig, resolve the binding, and pass `binding.targetRef` into the runtime AI
model or runner.

The SDK helper is:

```ts
import { resolveNimiAIConfigRuntimeBinding } from '@nimiplatform/sdk';
```

If `resolveNimiAIConfigRuntimeBinding(...)` returns
`profile-slice-unmaterialized`, the config still points at a profile slice. Use
the model configuration surface to apply or materialize the profile into a live
`local-runtime` or `cloud-connector` target before dispatch.

If it returns `target-ref-missing` or Runtime/Tester surfaces show
`ai-config-binding-missing`, the app has no selected model binding for that
capability. Choose a model in the Kit model-config UI or write the app AIConfig
store with a valid `targetRefs[capabilityId]` entry.

## Tester Unavailable Reasons

Tester intentionally displays typed unavailable states instead of treating every
failure as a missing SDK method.

| Reason | What it means | Action |
| --- | --- | --- |
| `runtime-not-ready` | Runtime cannot be reached yet. | Start or reconnect Runtime, then retry. |
| `ai-config-binding-missing` | No model binding exists for the capability. | Choose a model in the model control or apply an AIProfile. |
| `input-invalid` | Required prompt or capability input is missing or malformed. | Fix the input and run again. |
| `auth-context-missing` | The route requires a signed-in Nimi account. | Sign in through the Runtime-backed shell or switch the route to a local model binding. |
| `principal-unauthorized` | The Runtime account session is expired or unauthorized. | Sign in again and retry. |
| `sdk-method-unavailable` | The current app build does not expose that capability. | Update the app or use an admitted SDK capability. |
| `local-environment-preparing` | Runtime is preparing local image dependencies. | Keep Runtime running and retry after setup reaches ready. |
| `local-environment-blocked` | Required local image companion models are missing. | Select the required companion models before retrying. |
| `runtime-call-failed` | Runtime returned a typed contract failure. | Inspect the verbatim Runtime error and selected model. |
| `tauri-command-failed` | The desktop shell could not complete the command. | Reopen the shell or retry after shell readiness returns. |

## App Scaffold Checks

For an app created with `@nimiplatform/app-tools`, use the generated scripts:

```sh
pnpm run init
pnpm run doctor
pnpm run test
pnpm run check
```

`pnpm run doctor` verifies scaffold init/lock state, managed glue, package-owned
projections, dependency alignment, and forbidden shortcut patterns. A doctor
failure is a scaffold contract failure; use `pnpm run update` only for
scaffold-managed files and keep app-owned product code separate.

## What Not To Copy

- Do not import `runtime/internal/**` or `apps/**` implementation files into an
  external app.
- Do not bypass Runtime with app-local REST for AI execution.
- Do not hardcode provider/model identifiers in app-owned product code.
- Do not treat a Tester unavailable reason as success. It is the actionable
  failure state.

## Source Basis

- [`runtime/cmd/nimi/onboarding_helpers.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/cmd/nimi/onboarding_helpers.go)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`sdks/typescript/core/ai/runtime-target-ref.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-target-ref.ts)
- [`sdks/typescript/core/ai/config-runtime-binding.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config-runtime-binding.ts)
- [`apps/tester/src/tester/tester-unavailable.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-unavailable.ts)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)

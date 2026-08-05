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

## Runtime AI Capability Intent

`AI_CONFIG_NOT_FOUND` means Runtime has no AIConfig for the exact App owner used
by the call. Save a Local or Cloud intent for the requested capability through
the owning AIConfig surface, then retry the same request.

Capability intent does not resolve into a request-side model, route, connector,
target reference, or fallback. If the actual call returns an authorization,
feature-support, or execution error, preserve the typed Runtime failure and its
diagnostics. Do not synthesize another target in App code.

## Tester Unavailable Reasons

Tester intentionally displays typed unavailable states instead of treating every
failure as a missing SDK method.

| Reason | What it means | Action |
| --- | --- | --- |
| `runtime-unavailable` | Runtime cannot be reached for this request. | Start or reconnect Runtime, then retry. |
| `permission-required` | Text generation permission has not been granted. | Approve or restore the permission in Nimi Desktop, then retry. |
| `input-invalid` | Required prompt or capability input is missing or malformed. | Fix the input and run again. |
| `sdk-method-unavailable` | The current App build does not expose that capability. | Update the App or use an admitted SDK capability. |
| `runtime-call-failed` | Runtime returned a typed contract failure. | Inspect the verbatim Runtime error and diagnostics. |

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
- [`sdks/typescript/core/ai/capability-configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/capability-configuration.ts)
- [`sdks/typescript/core/ai/runtime-model.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-model.ts)
- [`apps/tester/src/tester/tester-unavailable.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-unavailable.ts)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)

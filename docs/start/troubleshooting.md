# Troubleshooting Nimi App Integration

Use this page when a Nimi App, SDK call, Nimi Lab lane, or local Runtime command
fails before a generation completes. It focuses on failures a third-party app
author can act on from the public surfaces.

## First Check The Runtime

Run:

```sh
nimi doctor
```

On a build with an admitted background/service controller, a stopped daemon
reports the bounded background next step:

```sh
nimi start
```

For source development or a build without that background topology, run it in
the foreground:

```sh
nimi serve
```

Where background management is admitted, verify its sanitized manager summary:

```sh
nimi health --json
```

## Restore the App Host Binding

An App must use its generated host-bound `NimiLocalAppClient`. If an error asks for an App ID because the code constructed a standalone client, restore the generated binding instead of adding an `appId` or gRPC endpoint. Runtime rejects App AI execution, storage, and configuration through an ordinary direct client.

Run the App through Home's Desktop-supervised Host, confirm its current registration and Nimi Access, and keep the same generated client for AI and AIConfig. After session rotation, refresh authorized references without replaying a previous business action.

## Runtime AI Capability Intent

`AI_CONFIG_NOT_FOUND` means Runtime has no AIConfig for the exact App owner used
by the call. Save a Local or Cloud intent for the requested capability through
the owning AIConfig surface, then retry the same request.

Capability intent does not resolve into a request-side model, route, connector,
target reference, or fallback. If the actual call returns an authorization,
feature-support, or execution error, preserve the typed Runtime failure and its
diagnostics. Do not synthesize another target in App code.

## Nimi Lab Unavailable Reasons

Nimi Lab intentionally displays typed unavailable states instead of treating every
failure as a missing SDK method.

| Reason | What it means | Action |
| --- | --- | --- |
| `runtime-unavailable` | Runtime cannot be reached for this request. | Start or reconnect Runtime, then retry. |
| `permission-required` | Text generation permission has not been granted. | Approve or restore the permission in Nimi Desktop, then retry. |
| `input-invalid` | Required prompt or capability input is missing or malformed. | Fix the input and run again. |
| `sdk-method-unavailable` | The current App build does not expose that capability. | Update the App or use an admitted SDK capability. |
| `runtime-call-failed` | Runtime returned a typed contract failure. | Inspect the verbatim Runtime error and diagnostics. |

## App Project Checks

Use the existing commands in an App Tools-generated project:

```sh
pnpm run check
pnpm run test
```

If `check` reports a nimicoding synchronization failure after a checkout or dependency change, first restore the project's locked dependencies with `pnpm install --frozen-lockfile`, then rerun the same check. A stale installed CLI can report drift against the wrong package version; do not rewrite managed files to match it.

After the first dependency installation, run `pnpm run init`. When scaffold-managed files or dependencies need synchronization, run `pnpm run sync`, then `check`; App-owned product code is preserved. The former `pnpm run doctor`, `pnpm run update`, and `local-audit` scripts are absent from current generated projects. These App project commands are distinct from Runtime's `nimi doctor` above.

## What Not To Copy

- Do not import `runtime/internal/**` or `apps/**` implementation files into an
  external app.
- Do not bypass Runtime with app-local REST for AI execution.
- Do not hardcode provider/model identifiers in app-owned product code.
- Do not treat a Nimi Lab unavailable reason as success. It is the actionable
  failure state.

## Source Basis

- [`runtime/cmd/nimi/onboarding_helpers.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/cmd/nimi/onboarding_helpers.go)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`sdks/typescript/core/ai/capability-configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/capability-configuration.ts)
- [`sdks/typescript/core/ai/runtime-model.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-model.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)

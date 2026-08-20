# Use Nimi Lab

`apps/lab/` is Nimi's local-development capability lab. It integrates the
current SDK, Kit, Runtime, Realm, and app-tools surfaces in one real Nimi App
so new capabilities can be exercised before a scaffold exposes them. A surface
can remain visibly integrated while its current carrier reports typed
unavailable; integration presence is not a runnable or scaffold-admission claim.

Nimi Lab is not platform admission truth. Runtime, Realm, SDK, Kit, release,
registry, and permission ownership remain with their respective platform
surfaces. App Tools generates only the capability slices it explicitly admits;
it does not copy the complete Lab.

## Run It

From the source checkout:

```bash
pnpm dev:lab
```

Inside `apps/lab/`, the relevant scripts are:

```bash
pnpm run init
pnpm dev:shell
pnpm run validate
pnpm run doctor
pnpm run update
pnpm run test
```

`dev:shell` enters the official `nimi-app dev` launcher; on Windows and macOS,
Nimi Lab runs as a Desktop-supervised Electron App. `build:shell` remains the
bounded native Tauri build path, not a second local-development carrier. A
local project that is not admitted must be authorized through Developer Mode
and launched as an isolated `local_development` build. Nimi Lab does not own
the principal, grant, or session and does not grant public App admission.

Realm-backed settings are currently preserved as an integrated Lab surface but
the local-app carrier returns typed unavailable. Treat its real owner journey
as `NOT-VERIFIED`; do not infer runnable Realm access from the visible UI.

## What To Study

| Need | Where to look |
| --- | --- |
| App scaffold scripts and local checks | `apps/lab/package.json` |
| Runtime-authenticated shell behavior | `apps/lab/README.md` and shell routes |
| AIConfig storage and App owner | `apps/lab/src/lab/lab-ai-config-store.ts` |
| Runtime AI dispatch from capability intent | `apps/lab/src/lab/lab-runtime.ts` |
| Fail-closed capability states | `apps/lab/src/lab/lab-non-success.ts` |
| AIConfig intent composition | `apps/lab/src/lab/workbench/lab-ai-config-settings-panel.tsx` |
| Contract checks | `apps/lab/test/lab-contract/` |

## What Not To Copy Blindly

- Nimi Lab identity (`nimi.lab`) belongs only to Nimi Lab.
- Lab-only diagnostics, Simulator adapters, fixtures, and demo data are not
  scaffold or production data contracts.
- A capability being present in Lab does not make it selectable in App Tools.
- Lab acceptance tests are examples of app-owned checks, not a substitute for
  your App's requirements.
- Runtime execution diagnostics are evidence; do not copy implementation,
  route, connector, or target details into App requests.
- Developer Mode is local development material, not public App listing
  admission.

## Common Failure States

| State | Meaning |
| --- | --- |
| `runtime-unavailable` | Runtime cannot be reached for the request. |
| `permission-required` | Text generation permission has not been granted. |
| `input-invalid` | Required capability input is missing or malformed. |
| `sdk-method-unavailable` | The current App build does not expose the required SDK method. |
| `runtime-call-failed` | Runtime returned a typed contract failure. |

The App should surface these states directly. Do not collapse them into a
single "SDK missing" or "model unavailable" message.

## Source Basis

- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`apps/lab/package.json`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/package.json)
- [`apps/lab/src/lab/lab-runtime.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-runtime.ts)
- [`apps/lab/src/lab/lab-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-ai-config-store.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)

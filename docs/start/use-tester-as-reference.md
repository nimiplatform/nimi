# Use Tester As A Reference App

`apps/tester/` is Nimi Lab: a developer reference app for generated Nimi App
repositories. Use it to understand how a real app wires Runtime auth, SDK
calls, Kit surfaces, app-tools scaffold checks, AIConfig capability intent,
capability lanes, and local acceptance tests.

Do not treat Tester as platform admission truth. It is an app-owned reference
surface, not the source of Runtime, SDK, Kit, Realm, release, registry, or
permission authority.

## Run It

From the source checkout:

```bash
pnpm dev:tester
```

Inside `apps/tester/` the relevant scripts are:

```bash
pnpm run init
pnpm dev:shell
pnpm run validate
pnpm run local-audit
pnpm run doctor
pnpm run update
pnpm run test
```

`dev:shell` launches the Tauri shell. The native host injects the standard-shell
local-app carrier. A local not-yet-admitted project must be authorized through
Developer Mode and launched as an isolated `local_development` build. Tester
does not own the principal, grant, or session and does not grant public app
admission.

## What To Study

| Need | Where to look |
| --- | --- |
| App scaffold scripts and local checks | `apps/tester/package.json` |
| Runtime-authenticated shell behavior | `apps/tester/README.md` and shell routes |
| AIConfig storage and App owner | `apps/tester/src/tester/tester-ai-config-store.ts` |
| Runtime AI dispatch from capability intent | `apps/tester/src/tester/tester-runtime.ts` |
| Fail-closed capability states | `apps/tester/src/tester/tester-unavailable.ts` |
| AIConfig intent composition | `apps/tester/src/tester/workbench/tester-ai-config-settings-panel.tsx` |
| Contract checks | `apps/tester/test/tester-contract/` |

## What Not To Copy Blindly

- Tester app identity (`nimi.tester`) is Tester-specific.
- Tester local fixtures and demo data are not production data contracts.
- Tester acceptance tests are examples of app-owned checks, not a substitute for
  your app's requirements.
- Runtime execution diagnostics are evidence; do not copy implementation,
  route, connector, or target details into App requests.
- Developer Mode is local development material, not public app listing
  admission.

## Common Failure States

| State | Meaning |
| --- | --- |
| `runtime-unavailable` | Runtime cannot be reached for the request. |
| `permission-required` | Text generation permission has not been granted. |
| `input-invalid` | Required capability input is missing or malformed. |
| `sdk-method-unavailable` | The current App build does not expose the required SDK method. |
| `runtime-call-failed` | Runtime returned a typed contract failure. |

The app should surface these states directly. Do not collapse them into a
single "SDK missing" or "model unavailable" message.

## Source Basis

- [`apps/tester/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/README.md)
- [`apps/tester/package.json`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/package.json)
- [`apps/tester/src/tester/tester-runtime.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-runtime.ts)
- [`apps/tester/src/tester/tester-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-ai-config-store.ts)
- [`apps/tester/src/tester/tester-unavailable.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-unavailable.ts)

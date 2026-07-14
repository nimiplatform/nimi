# Use Tester As A Reference App

`apps/tester/` is Nimi Lab: a developer reference app for generated Nimi App
repositories. Use it to understand how a real app wires Runtime auth, SDK
calls, Kit surfaces, app-tools scaffold checks, AIConfig bindings, capability
lanes, and local acceptance tests.

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
| AIConfig storage and app scope | `apps/tester/src/tester/tester-ai-config-store.ts` |
| Runtime AI dispatch with AIConfig binding | `apps/tester/src/tester/tester-runtime-invokers-core.ts` |
| Fail-closed capability states | `apps/tester/src/tester/tester-unavailable.ts` |
| Kit model-config integration | `apps/tester/src/shell/ai/` and `apps/tester/src/shell/routes/settings/` |
| Contract checks | `apps/tester/test/tester-contract/` |

## What Not To Copy Blindly

- Tester app identity (`nimi.tester`) is Tester-specific.
- Tester local fixtures and demo data are not production data contracts.
- Tester acceptance tests are examples of app-owned checks, not a substitute for
  your app's requirements.
- Runtime route ids, AIConfig target refs, and provider connector ids must come
  from your app's Runtime/model-config flow.
- Developer Mode is local development material, not public app listing
  admission.

## Common Failure States

| State | Meaning |
| --- | --- |
| `runtime-not-ready` | Runtime is not reachable or ready for the lane. |
| `ai-config-binding-missing` | No AIConfig target is selected for that capability. |
| `auth-context-missing` | The route needs a signed-in Runtime account subject. |
| `principal-unauthorized` | The Runtime account session is expired or unauthorized. |
| `sdk-method-unavailable` | The current app build does not expose the required SDK method. |
| `runtime-call-failed` | Runtime returned a typed contract/provider failure. |

The app should surface these states directly. Do not collapse them into a
single "SDK missing" or "model unavailable" message.

## Source Basis

- [`apps/tester/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/README.md)
- [`apps/tester/package.json`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/package.json)
- [`apps/tester/src/tester/tester-runtime-invokers-core.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-runtime-invokers-core.ts)
- [`apps/tester/src/tester/tester-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-ai-config-store.ts)
- [`apps/tester/src/tester/tester-unavailable.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-unavailable.ts)

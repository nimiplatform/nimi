# Acme Widget

Profile: `standalone`

This is a local-development Nimi App source project created from the identity-neutral, Lab-derived `workbench-core` plus the exact selected module dependency closure and generated target glue. It is a positive composition, not a full Lab copy, runtime-hidden feature set, or release/admission record.

The canonical identity, direct feature selection, resolved modules, App Access declaration, dependency projection, and ownership inputs are recorded in `.nimi/app-scaffold/intent.json`. Selected product modules live under `src/capabilities/**`.

## Ownership

- App-owned product code: `src/workbench-core/**`, selected `src/capabilities/**`, and App-author product edits.
- Scaffold-managed code: carrier/auth wiring, identity, manifests, bounded native integration, project tooling, and `src/scaffold/generated/**`.
- Package-owned projection: `.nimi/{config,contracts,methodology}/**`, created by the pinned local `nimicoding` package during explicit initialization.

`doctor` and `update` may inspect or refresh scaffold-managed output, but they do not overwrite app-owned skeleton or module code. Changing identity, profile, or feature selection requires a fresh scaffold.

## Required workflow

`create` has already completed for this source tree. Continue in this order:

```bash
# 1. install dependencies
pnpm install

# 2. initialize package-owned projection and scaffold lock
pnpm run init

# 3. inspect and build
pnpm run doctor
pnpm run validate
pnpm run build
pnpm run build:electron

# 4. launch through the Desktop supervisor
pnpm dev
```

Run `init`, `doctor`, and `update` only after dependency installation. Installation alone does not mutate `.nimi/**`. If managed output later needs refresh, run `pnpm run update` only in an installed project, then rerun doctor and the affected build.

`pnpm dev` selects the official Desktop-supervised Electron carrier. The explicit equivalent is:

```bash
pnpm dev:shell -- --shell electron
```

For an explicit local CDP observation run:

```bash
pnpm dev -- --cdp-port 9334
```

The port is loopback-only and CDP stays disabled when omitted. Direct Electron or Tauri development launches are not substitutes for the Desktop-supervised journey.

## Profile evidence

- A `standalone` project must resolve only the exact public npm and Cargo registry versions in its manifests. Workspace paths, local path overrides, tarballs, downgrades, and workspace links are not valid substitutes.
- A `workspace-app` project must remain a direct `apps/*` package in the supported Nimi workspace and use its exact workspace dependency topology.

A passing workspace build or launch does not prove standalone.

## Product boundary

AI selections share the internal `ai-studio-core` once; it is dependency-only and not a direct public selection. Unselected modules are absent from source and navigation. Lab-only Settings/account, App Access diagnostics, Realm/Agent probes, World Tour, and native or diagnostic surfaces are not part of this generated App.

Runtime, Realm, admission, listing, permission, install, and release truth remain platform-owned. The project never stores Runtime credentials or protected session material and does not create permission grants.

## Acceptance status

This README does not certify the generated App. Install, init, doctor, build, Electron build, Desktop-supervised launch, responsive/accessibility states, and selected-module interactions remain `NOT-VERIFIED` until they are actually run. Focused tests or CDP visibility alone are not implementation or release acceptance.

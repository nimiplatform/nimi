# Acme Widget

This standalone App was generated as an identity-neutral base plus the explicitly selected admitted feature closure.

Profile: `standalone`.

- App-owned product code: `src/workbench-core/**`, selected `src/capabilities/**`, and subsequent product edits.
- Scaffold-managed code: carrier/auth wiring, identity, manifests, build/release inputs, managed workflow and generated composition glue.
- Package-owned projections: `.nimi/{config,contracts,methodology}/**`, materialized by the pinned local `nimicoding` package during `init`.

`sync` refreshes scaffold-managed files without overwriting App-owned code. `check` is non-mutating. Changing identity, profile or direct feature selection requires a fresh scaffold.

## Workflow

`create` has completed. Continue in this order:

```bash
pnpm install
pnpm run init
pnpm run sync
pnpm run check
pnpm run test
pnpm run app:build -- --target windows-x86_64
pnpm dev
```

After a real target build, `pnpm run pack -- --target <target-id>` uses app-tools as the only package owner. Local publish is unavailable; a protected version tag runs the managed GitHub Release workflow, while registry pull-request orchestration remains unavailable until its owner path exists.

Before production, the public GitHub repository must enable a protected `v*` tag ruleset and immutable releases and provide a read-only repository-admin token for checking those settings. On Windows, the tag-only production build signs the exact declared Host with the publisher PFX; production pack only verifies the resulting Authenticode signature. Manual workflow dispatch runs only the non-production path. The resulting GitHub Release remains independent from registry admission, Runtime installation, Desktop launch, and Nimi Access.

`pnpm dev` selects the official Desktop-supervised Electron development Host. Direct renderer, Electron or Tauri launch does not create protected Nimi access.

Runtime, Realm, registry admission, installed state and process truth remain with their canonical owners. This repository stores no Runtime credentials or protected session material.

## Support

Report startup or Runtime issues through this repository's issue tracker. Diagnostics must exclude credentials and other private data.

## Acceptance status

This README does not certify the App. Dependency install, test, build, target pack, GitHub Release, registry admission, Runtime install, Desktop launch and principal interactions remain `NOT-VERIFIED` until actually run. Focused tests or CDP visibility are not release acceptance.

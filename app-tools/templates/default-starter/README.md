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

Before production, the public GitHub repository must enable a protected `v*` tag ruleset and immutable releases and provide a read-only repository-admin token for checking those settings. On Windows, the tag-only production build runs the App-declared build owner without a Nimi signing step. A publisher may sign the exact declared Host through its own build or signing custody; production pack records either verified Authenticode or explicit unsigned posture and rejects invalid or unresolved signatures. Manual workflow dispatch runs only the non-production path. The resulting GitHub Release remains independent from registry admission, Runtime installation, Desktop launch, and Nimi Access.

`pnpm dev` selects the official Desktop-supervised Electron development Host. Direct renderer, Electron or Tauri launch does not create protected Nimi access.

The default `windows-x86_64` build creates a fresh non-installer Electron directory at `dist-electron-package/acme-widget-shell-win32-x64/`, with the App-specific `acme-widget-shell.exe`, unpacked renderer files (`asar: false`), and relative renderer assets. Its production bundle rejects `--nimi-dev-renderer-url`. The protected native binding arrives only through Kit's optional dependency; do not add it directly to this App.

`pnpm run build:tauri:production` remains an explicit alternative for a deliberately selected Tauri build profile; it is not the default production carrier.

Runtime, Realm, registry admission, installed state and process truth remain with their canonical owners. This repository stores no Runtime credentials or protected session material.

## Support

Report startup or Runtime issues through this repository's issue tracker. Diagnostics must exclude credentials and other private data.

## Acceptance status

This README does not certify the App. Dependency install, test, build, target pack, GitHub Release, registry admission, Runtime install, Desktop launch and principal interactions remain `NOT-VERIFIED` until actually run. Focused tests or CDP visibility are not release acceptance.

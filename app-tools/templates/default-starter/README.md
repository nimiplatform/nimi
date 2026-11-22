# Acme Widget

This standalone App was generated from an identity-neutral base combined with the explicitly selected admitted features.

Profile: `standalone`.

Home displays the App-owned root `NIMI_APP.md`. Maintain its purpose, first-use steps, configuration, data handling, limitations and help for actual App users. This README covers repository development. Do not declare `metadata.readme`; there is no README fallback.

## Code Ownership

- **App-owned product code**: `src/workbench-core/**`, selected `src/capabilities/**`, `src/shell/routes/app-navigation.tsx`, and your subsequent product edits. Extend the App-owned destination catalog and use its single Kit controller for navigation position. Keep drafts, business records, and one-time actions within their respective business owners. If no feature was selected, the base starts without a sidebar or fold command.
- **App-owned license**: `LICENSE` starts as an MIT license naming the package author (or the App title if no author was given). Replace it with the App's own terms as needed and set the matching `license` identifier in `package.json` before packaging. `sync` never rewrites `LICENSE`.
- **Scaffold-managed code**: Carrier and auth wiring, identity, manifests, build/release inputs, managed workflows, generated composition glue, and the template's own license notice in `licenses/nimi-app-template.txt`.
- **Package-owned projections**: `.nimi/{config,contracts,methodology}/**`, materialized by the pinned local `nimicoding` package during `init`.

`sync` refreshes scaffold-managed files without overwriting App-owned code. `check` is read-only and non-mutating. Changing the App's identity, profile, or direct feature selection requires generating a fresh scaffold.

## Workflow

`create` has completed. Run the following commands in order:

```bash
pnpm install
pnpm run init
pnpm run sync
pnpm run check
pnpm run app:build
pnpm dev
```

### Local Development

Open Nimi Home, sign in and enable Developer Mode before running `pnpm dev`. Add an App test under `test/*.test.mjs` and run it with `pnpm test`.

### Building & Carrier Layout

<!-- carrier: managed-web -->
This App builds static frontend files into `dist/renderer/`. Nimi Home runs them in its managed desktop carrier on Windows x64 and macOS arm64. Both platforms use the same package.

Set the summary, PNG icon and release notes in `nimi.app.yaml` and the license identifier in `package.json`. Run `pnpm exec nimi-app pack --target desktop-universal` after building. The resulting `.nimiapp` is in `dist/nimi-app/`.
<!-- end carrier -->
<!-- carrier: native -->
The `windows-x86_64` build outputs a fresh non-installer Electron directory at `dist-electron-package/acme-widget-shell-win32-x64/`, containing:

- The App-specific executable `acme-widget-shell.exe`
- ASAR-packaged JavaScript and renderer assets
- Unpacked native add-ons and shared libraries (`**/*.{node,dylib,dll}`) with their relative layout preserved for the OS loader

The production bundle rejects `--nimi-dev-renderer-url`. The protected native binding arrives only through Kit's optional dependency—do not add it directly to this App.

Electron packages target Windows x64 and macOS arm64. Standard builds use Node, pnpm and the prebuilt native Kit package for the target.

Run `pnpm exec nimi-app pack --target windows-x86_64` on Windows or `pnpm exec nimi-app pack --target macos-aarch64` on macOS after building. Publishers may sign the Windows executable before packing. Production packing records the observed Authenticode signature or an explicit unsigned posture.
<!-- end carrier -->

### Packaging & Release Boundaries

Pushing a protected version tag triggers the managed GitHub Release workflow. Submit the resulting immutable Release through the Registry pull-request and human-review flow.

Before cutting a production release, enable a protected `v*` tag ruleset and immutable releases in the public GitHub repository, and provide a read-only repository-admin token to verify those settings. Manual workflow dispatch runs a development build.

A GitHub Release remains independent from registry admission, Runtime installation, Desktop launch, and Nimi Access. Runtime, Realm, registry admission, installed state, and process truth remain with their canonical owners. This repository stores no Runtime credentials or protected session material.

## Publish with GitHub

`NIMI_REPOSITORY_ADMIN_TOKEN` is used only to inspect tag-protection and Release immutability settings and requires **Administration: Read-only** permission. The built-in GitHub token handles the actual Release upload but cannot read the Release immutability setting. Local development does not require `NIMI_REPOSITORY_ADMIN_TOKEN`.

Complete these one-time repository settings before pushing a release tag:

1. **Settings → General → Releases:** Enable Release immutability.
2. **Settings → Rules → Rulesets:** Create an active tag ruleset for `v*` that restricts updates and deletions.
3. [Create a fine-grained token](https://github.com/settings/personal-access-tokens/new) scoped to this repository's owner and only this repository, with **Administration: Read-only**. Complete organization approval if required.
4. **Settings → Secrets and variables → Actions → New repository secret:** Save the token under the exact name `NIMI_REPOSITORY_ADMIN_TOKEN`.

See the [step-by-step publishing guide](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md#publishing-on-github) for repository setup, permission details, version tagging, and recovery from setup errors. Local checks do not verify GitHub secrets.

When ready to release:

1. Run `pnpm exec nimi-app check --production`, followed by the real production build and pack.
2. Commit the release on the repository's default branch and push an annotated `v<package.json version>` tag.
3. Monitor **Actions → nimi-app-release**. If a repository setting or secret is missing, fix it and choose **Re-run failed jobs** while keeping the existing tag.
4. Submit the resulting immutable Release for separate human review to request registry admission.

## Support

Report startup or Runtime issues through this repository's issue tracker. Remove credentials and other private data from all diagnostics before submitting.

## Acceptance status

This README does not certify the App. Dependency installation, tests, builds, target packaging, GitHub Releases, registry admission, Runtime installation, Desktop launch, and principal user interactions remain `NOT-VERIFIED` until actually executed. Focused tests or CDP visibility do not constitute release acceptance.

# Release Process

This repository has three distinct release identities. They must not be merged:

- Nimi installable product releases coordinate Desktop, Runtime, signing, update,
  and rollback.
- First-party public components release independently from component tags.
- Third-party Nimi Apps publish from their own publisher repositories and managed
  App workflows.

## First-party public components

Production publication is tag-only. Manual workflow dispatch is dry-run only.

| Component | Production tag | Workflow | Destination |
| --- | --- | --- | --- |
| `@nimiplatform/sdk` | `sdk/v<version>` | `release.yml` | npm |
| `@nimiplatform/kit` | `kit/v<version>` | `release-kit.yml` | npm |
| `nimi-shell-protected-local` | `nimi-shell-protected-local/v<version>` | `release-nimi-shell-protected-local.yml` | crates.io |
| `nimi-shell-tauri` | `nimi-shell-tauri/v<version>` | `release-nimi-shell-tauri.yml` | crates.io |
| `@nimiplatform/app-tools` | `app-tools/v<version>` | `release-app-tools.yml` | npm |

For SDK, Kit, and App Tools, the tag version must equal the exact package.json
version. They remain independently versioned; no root `vX.Y.Z` tag, aggregate
manifest, RC bundle, or global promotion workflow identifies those packages.

The npm workflows retain their historical filenames because npm Trusted
Publisher configuration binds the repository and exact workflow identity. They
publish with GitHub OIDC and npm provenance and do not use `NPM_TOKEN`. Pull
request and manual dry-run jobs have no OIDC permission; only the tag-only publish
job receives `id-token: write` and it publishes the exact tarball validated by the
preceding job.

## Pull request and dry-run boundary

The component workflows run their affected build, tests, deterministic pack, and
available registry dry-run on pull requests. Tauri source tests run immediately;
its cargo-package dry-run remains `NOT-VERIFIED` until its exact protected-local
version is public. A release reconciliation PR is not merged until required
repository checks and these component checks pass.

After merge, a maintainer may run a component workflow manually for another
dry-run. A manual dispatch cannot publish. Production publication starts only by
pushing the exact component tag at a commit already contained in `origin/main`.

Every npm package is packed before publication. The Kit tarball is the current
JS-only public package: it rewrites the workspace SDK dependency to its public
caret range and omits deferred native carrier optional dependencies. Runtime and
Kit native carriers do not enter these component releases.

## Dependency order

The two independent roots may begin separately:

1. Publish SDK from `sdk/v<SDK version>`.
2. Publish protected-local from
   `nimi-shell-protected-local/v<protected-local version>`.

Then publish dependants:

3. Kit waits for its declared SDK version to be visible on npm.
4. Tauri reads the protected-local version declared by its own Cargo dependency
   and waits for that version to be visible on crates.io; it does not reuse the
   Tauri component version as protected-local identity.
5. App Tools waits for the SDK, Kit, and Tauri versions embedded in its packed
   scaffold contract to be visible in their public registries. The Tauri
   publisher has already closed its protected-local dependency.

For the current prepared versions, the intended tags are:

```text
sdk/v0.7.0
kit/v0.3.0
nimi-shell-protected-local/v0.2.0
nimi-shell-tauri/v0.2.0
app-tools/v0.2.0
```

Proto has no package manifest version and has no active production publisher in
this release set. A future Proto publication identity requires separate authority
and is not inferred from another component.

## Immutable tag recovery

Component release tags are immutable and must never be moved, deleted, or reused.
A transient workflow retry may run again from the same unchanged tag and verifies
an already-published registry version only when its bytes match. A code change
requires the next component version and a new component tag.

The historical `v0.2.0-rc.1`, `v0.2.0`, and `v0.2.1-rc.1` refs are abandoned
global-library-train attempts. They remain immutable history and are not SDK,
Kit, App Tools, shell, Proto, third-party App, or installable-product release
truth. Do not promote, move, or reuse them.

## Unsigned developer preview

`.github/workflows/release-preview.yml` remains a separate unsigned developer
preview path. It accepts an exact main commit, preview version, and sequence
number and produces immutable development assets with different per-OS payloads:

- Windows x64 contains only the source-local Kit package. It contains no Nimi
  App, Runtime archive, installer, or Windows service package.
- macOS arm64 contains an ad-hoc, repo-assisted `Nimi Dev.app` candidate and
  Runtime payload. Installation and uninstallation require the exact source
  checkout; the asset is not a standalone installer.
- Linux has no preview asset.

The preview does not publish npm packages, crates, or Proto and never becomes
input to a component release. It does not establish a Nimi product release,
public download, native installation, first launch, self-update, or uninstall.
Runtime service distribution, Desktop production signing/notarization, and Kit
native carrier publication remain deferred.

## Credentials and external configuration

- npm: Trusted Publisher for `nimiplatform/nimi` and the exact component workflow
  filename; GitHub-hosted runner with `id-token: write`.
- crates.io: repository `CARGO_REGISTRY_TOKEN` for the two shell workflows.
- GitHub: component tag rules must prevent update and deletion while allowing the
  first tag creation.

Do not add local npm publication, manual production dispatch, registry upload
fallbacks, or another global component publisher.

## Post-release verification

For each published component, verify:

- the immutable component tag resolves to the intended main commit;
- the registry version is visible;
- npm provenance names the exact component workflow and component tag;
- the published dependency versions match the package or scaffold contract;
- a public install or Cargo resolution no longer uses workspace/path sources.

These checks establish component publication only. They do not establish a Nimi
product release, third-party App admission, installation, running process, or
Nimi Access readiness.

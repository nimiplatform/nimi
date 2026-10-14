# Release Architecture & Process

This document outlines the release process, versioning policies, and CI publishing pipelines across the Nimi ecosystem.

User-facing download and release status is canonically maintained at <https://nimi.ai/download>.

---

## 1. Three Distinct Release Identities

The Nimi repository manages three independent publication tracks:

1. **Nimi Installable Product (Desktop & Runtime)**: Coordinated release of Desktop installers and local Runtime daemons across supported platforms (macOS arm64, Windows x86_64).
2. **First-Party Libraries & Tooling**: Public npm packages (`@nimiplatform/sdk`, `@nimiplatform/kit`, `@nimiplatform/app-tools`, `@nimiplatform/sdk-adapter-vercel-ai`) and Crates.io packages (`nimi-shell-tauri`).
3. **Ecosystem Applications**: Distributed as `.nimiapp` packages via the public [Nimi App Registry](https://github.com/nimiplatform/nimi-app-registry).

---

## 2. Public Component Release Matrix

First-party component publication starts exclusively from protected Git tags. Manual CI dispatches perform dry-run verification only.

| Package | Tag Format | Workflow | Registry |
| :--- | :--- | :--- | :--- |
| `@nimiplatform/sdk` | `sdk/v<version>` | `release.yml` | npm |
| `@nimiplatform/kit` and matching `kit-protected-local-*` npm packages | `kit/v<version>` | `release-kit.yml` | npm |
| `@nimiplatform/sdk-adapter-vercel-ai` | `sdk-adapter-vercel-ai/v<version>` | `release-sdk-adapter-vercel-ai.yml` | npm |
| `@nimiplatform/app-tools` | `app-tools/v<version>` | `release-app-tools.yml` | npm |
| `nimi-shell-protected-local` | `nimi-shell-protected-local/v<version>` | `release-nimi-shell-protected-local.yml` | crates.io |
| `nimi-shell-tauri` | `nimi-shell-tauri/v<version>` | `release-nimi-shell-tauri.yml` | crates.io |

### Provenance & Security
- All npm packages publish using GitHub Actions OIDC and npm provenance (without static `NPM_TOKEN` secrets).
- Release jobs validate the exact tarball before publication. For an already published npm version, they compare its SHA-1 with the immutable registry package rather than overwriting it.

---

## 3. Publication Dependency Order

First-party components must be published in dependency order so downstream packages can resolve their declared versions from the public registry:

1. **Independent Release Roots**: `@nimiplatform/sdk` and `nimi-shell-protected-local` have no internal release dependencies and can be published first.
2. **First-Level Dependents**:
   - `@nimiplatform/kit` and `@nimiplatform/sdk-adapter-vercel-ai` wait for their declared `@nimiplatform/sdk` version. (Under a `kit/v<version>` tag, Kit publishes its platform-native `kit-protected-local-*` npm packages before the main `@nimiplatform/kit` package.)
   - `nimi-shell-tauri` waits for its declared `nimi-shell-protected-local` crate version.
3. **Scaffolding Tooling**: `@nimiplatform/app-tools` waits for the SDK, Kit, and Tauri versions embedded in its scaffold contract.

### Tagging & Versioning Rules
- Use each component's own manifest version and confirm that upstream dependencies are live in the public registry before tagging.
- Tags must point to commits already in `origin/main`.
- **Immutable Tags**: Never move, delete, or reuse a component release tag. Retry transient failures on the unchanged tag, and bump to a new version whenever code changes are needed.

The installable product follows a separate [release procedure](scripts/release/PRODUCT-RELEASE.md), which covers coordinated signing, update, and rollback checks.

---

## 4. Third-Party App Release Flow

Ecosystem apps developed with `@nimiplatform/app-tools` follow an immutable release chain:

1. **Local Pre-flight**: App authors run `pnpm exec nimi-app check --production` locally.
2. **Automated Packaging**: After configuring protected tags, Release immutability, and the read-only repository-settings credential described in [App Tools](app-tools/README.md#publishing-on-github), pushing an annotated `v<version>` tag triggers the app's GitHub Actions workflow to build and package `.nimiapp` along with its metadata sidecars.
3. **Registry Submission**: The author opens an admission PR in the Nimi App Registry referencing the immutable GitHub Release.
4. **Admission & Lifecycle Verification**: Human Registry admission makes the approved target available to Catalog consumers. Installation, launch, and Nimi Access remain separate checks; current package lifecycle targets are macOS arm64 and Windows x86_64.

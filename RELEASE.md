# Release Process

Nimi uses one repository-wide release train:

```text
Release PR -> immutable unsigned preview (optional, never promotable)
           -> signed canary for an exact commit -> immutable global RC tag
           -> approved same-commit, same-signed-artifact stable promotion
```

Release tags are global (`vX.Y.Z-preview.N`, `vX.Y.Z-rc.N`, and `vX.Y.Z`). Public packages
keep independent versions in their own manifests. There are no component-tag
publish workflows and no alternate manual-publish path.

## Public Release Surfaces

| Surface | Destination | Promoted artifact |
|---|---|---|
| Runtime | Deferred | Raw Go archives are not a standalone protected Runtime distribution |
| Runtime npm launcher | Deferred | Blocked with Runtime until supported platform service/bootstrap packages exist |
| SDK | npm | `@nimiplatform/sdk` |
| Kit | npm | `@nimiplatform/kit` plus admitted native packages |
| App Tools | npm | `@nimiplatform/app-tools` |
| Protected Local shell | crates.io | `nimi-shell-protected-local` |
| Tauri shell | crates.io | `nimi-shell-tauri`, built from its sealed source archive after protected-local is visible |
| Proto | buf.build | Module built from the sealed Proto source archive |
| Desktop | Deferred | No production Electron distribution is admitted yet |

Runtime and Proto use the global release version supplied to the canary
workflow. npm and Cargo component versions come from their package manifests.

## 1. Release PR

The Release PR freezes the exact commit that will become a canary. Before it is
eligible:

- Every public npm and Cargo manifest contains its final stable SemVer. RC
  identity belongs only to the global Git tag, GitHub Pre-release, and any
  explicitly admitted registry channel; package versions must not retain an
  `-rc.N` suffix if the same package bytes will become stable.
- Internal package references, native package versions, App Tools scaffold
  versions, licenses, repository metadata, and npm provenance metadata are in
  sync.
- `CHANGELOG.md` has the global release version section, and
  `kit/CHANGELOG.md` has the Kit package version section.
- The complete local pre-release command passes:

```bash
NIMI_RELEASE_TAG=vX.Y.Z pnpm pre-release
```

That command binds the global changelog heading to the intended stable tag,
fails fast on release metadata, then runs actionlint, Proto contract gates, all
builds and bundle budgets, the full test suite, Runtime/Cognition lint and
Runtime vulnerability checks, examples, licenses, and final SDK/Kit pack
audits.
The affected real journey or platform job remains required where a generic
workspace build cannot exercise it.

## Unsigned Preview

Run `.github/workflows/release-preview.yml` with the exact main-ancestor
`commit_sha`, stable `release_version`, and a new positive `preview_number`.
The workflow creates the immutable GitHub prerelease tag
`vX.Y.Z-preview.N` only after all of these paths pass:

- the complete `pnpm pre-release` gate;
- Windows x64 source-local Kit npm download, `NotSigned` verification,
  install/require/uninstall, and removal of the installed package path;
- macOS arm64 ad-hoc identity verification, downloaded-candidate install,
  Runtime and App version checks, App launch, status, uninstall, and final
  absence through the exact source checkout's repo-assisted command.

The Windows preview contains only a source-local Kit native package; it does not
contain the Nimi App, a Runtime archive, installer, or Windows service. No Linux
preview asset is published. The macOS preview is a repo-assisted
local-development candidate with `Signature=adhoc` and `TeamIdentifier=not set`;
it is not a standalone installer, Developer ID signed, or notarized. From the
exact candidate commit, install it with
`node scripts/accept-runtime-fixed-service.mjs --install-candidate
<absolute-candidate-path>` and uninstall it with
`node scripts/accept-runtime-fixed-service.mjs --uninstall`.

The macOS development install creates the `_nimiruntimedev` user and group,
`ai.nimi.runtime.dev` LaunchDaemon, `/Applications/Nimi Dev.app`,
`/Library/Application Support/Nimi/RuntimeDev`,
`/usr/local/libexec/nimi-macos-dev-security`, and local Runtime socket paths.
The accepted uninstall removes that development namespace. The empty,
root-owned `/private/var/run/nimi-macos-dev-security.lock` operation lock may
remain until reboot. Every release note and marker starts with
`UNSIGNED PREVIEW — NOT PROMOTABLE`.
The Windows tarball carries its complete MIT `LICENSE`; the macOS archive
carries complete MIT and Apache-2.0 texts under `LICENSES/` for its
App/Kit/Avatar and Runtime material.

Preview assets are never published to npm, crates.io, or buf.build, never update
the stable `latest` feed, and never become canary, RC, or Stable inputs. A future
signed RC is rebuilt from the same source line after the production platform
signers are available; preview tags and assets are never moved or overwritten.
Repository immutable releases and the no-bypass `v*` tag ruleset are operational
prerequisites before dispatch. The workflow verifies the published Release
reports `isImmutable=true`; its ordinary `GITHUB_TOKEN` cannot read the
administrator-only repository setting before publication, so do not dispatch
after disabling that setting.

## 2. Canary

Run `.github/workflows/release-canary.yml` with:

- `commit_sha`: exact lowercase 40-character Git commit SHA
- `release_version`: global stable SemVer without `v`

The workflow checks out that SHA, requires it to be on `main`, runs the full
pre-release admission command, builds the real public artifacts, validates
their packed payloads, and uploads a sealed Actions artifact named:

```text
release-canary-<release_version>-<commit_sha>
```

Canary does not create or move a Git tag, create a GitHub Release, or publish to
an external registry. Re-running canary creates a new Actions artifact for the
same identity; RC admits the latest successful, unexpired artifact with that
exact name.

Runtime canary is currently fail-closed before packaging because the raw
GoReleaser archives cannot start the protected Runtime on their target
platforms. A supported service/bootstrap distribution and a real
start-health-stop acceptance path must replace that blocker before Runtime or
its npm launcher can enter RC or Stable. GoReleaser remains configured as an
archive builder with GitHub publishing disabled; its current version-only
archive smoke is build diagnostics, not release acceptance.

## 3. Immutable RC

After accepting a canary, create the next global RC tag on the same commit:

```bash
git tag vX.Y.Z-rc.N <canary-commit-sha>
git push origin vX.Y.Z-rc.N
```

`.github/workflows/release-candidate.yml` then:

1. Finds the successful canary artifact for the exact global version and tag
   commit.
2. Verifies every component manifest, artifact size, and SHA-256 digest.
3. Reseals the same files as RC artifacts without rebuilding product bytes.
4. Generates Runtime SPDX SBOMs, signs Runtime archives, SBOMs, and checksums,
   and reseals the Runtime manifest.
5. Installs the compatible npm tarballs locally and verifies the Runtime
   launcher reports the intended version.
6. Creates and publishes the real GitHub Pre-release for `vX.Y.Z-rc.N`.

RC does not currently publish to npm, crates.io, or buf.build. If an RC fails or
needs a code change, fix the code, run a new canary for the new commit, and use
`rc.N+1`. Do not move, replace, or reuse an existing RC tag or GitHub
Pre-release.

Ordinary `/runtime/latest.json` installation is stable-only and never falls
back to an RC. Test an RC from its explicit GitHub Pre-release assets or the
installer's explicit `--version vX.Y.Z-rc.N` path.

## 4. Stable Promotion

Run `.github/workflows/release-promote.yml` with the accepted `rc_tag` and
approve its `stable-release` environment.

Promotion:

1. Downloads the published RC assets and verifies all component manifests and
   Runtime signatures.
2. Creates or verifies global stable tag `vX.Y.Z` at the exact RC commit.
3. Verifies the RC tag, stable tag, and every manifest name the same commit and
   artifact bytes.
4. Publishes the exact npm tarballs with provenance in dependency order.
5. Rebuilds protected-local from the admitted SHA, requires its `.crate`
   SHA-256 to equal the RC asset, and publishes it first. It then packages and
   publishes Tauri from the exact sealed RC source archive after protected-local
   is visible; Cargo cannot package that path dependency before its registry
   version exists.
6. Builds and lints Proto from the exact RC source archive, then pushes that
   source to buf.build.
7. Publishes App Tools only after its embedded SDK, Kit, protected-local, and
   Tauri versions are visible in their registries.
8. Creates the stable GitHub Release from the same RC assets and marks it
   latest.

An already-published npm or Cargo version is accepted only when it is the same
version and bytes; a conflicting immutable registry version fails promotion.

### One-time Install Gateway global-tag cutover

The first global stable release also requires one explicit Worker deployment.
After the stable GitHub Release exists, manually run
`.github/workflows/deploy-install-gateway.yml` with `commit_sha` set to the
accepted RC commit SHA. The workflow checks out that exact main commit, tests
and builds the Worker, and performs the real Cloudflare deployment. This
global-tag hard cut is not operationally complete until that deployment
succeeds and `https://install.nimi.ai/runtime/latest.json` returns the new
global stable tag with the complete Runtime archive set.

The deployment requires repository `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` secrets; `NIMI_GITHUB_RELEASES_TOKEN` remains optional
for authenticated GitHub API reads.

The Worker resolves later stable releases dynamically from GitHub, so this is
not a standing requirement to redeploy unchanged gateway code on every release.

## Platform Signing Status

- Runtime macOS Go archives do not require Apple Developer ID and remain part
  of canary, RC, and stable output.
- Desktop Electron production distribution and the Kit macOS protected-local
  native package are deferred until the Apple signing/notarization path exists.
  Ad-hoc candidates may be published only through the explicit unsigned-preview
  lane and are not production releases or signed-RC inputs.
- The SignPath Foundation application is pending, no production Authenticode
  signer is configured, and no current Nimi Windows artifact is production
  signed. Kit Windows protected-local publication and the Windows Runtime
  production release are therefore blocked; the signed canary lane intentionally
  fails closed while the separate preview lane publishes only clearly marked,
  non-promotable unsigned assets.
- The repository's self-signed certificate flow is local-development only.
  `provision:windows-dev-trust` is not a release substitute and its certificate
  must never be distributed or installed into a user's Root or TrustedPublisher
  stores by a production installer.
- The planned Nimi-owned signing scope is the Windows Runtime `nimi.exe` for
  amd64/arm64 and the Kit protected-local Node native `.node` carrier. An
  installer, service helper, or repair helper joins that scope only if it is
  actually admitted to release. Third-party or upstream binaries must not be
  signed with Nimi's signing identity.
- RC `.sig`/`.pem` cosign blob signatures authenticate release files but are not
  Windows Authenticode signatures and do not establish a Windows Publisher.
- Consistent Windows PE Product Name/Product Version enforcement and complete,
  tested installer/service uninstallation behavior are not yet admitted. Both
  remain release blockers before a production Windows download can be offered.

The canonical public status and verification targets are the
[Download page](https://nimi.ai/download) and
[Code signing policy](https://nimi.ai/code-signing). Those URLs must not be
described as deployed merely because their repository sources exist.

## Required Credentials and Permissions

Stable promotion requires:

- `NPM_TOKEN`
- `CARGO_REGISTRY_TOKEN`
- `BUF_TOKEN`
- approval for the `stable-release` GitHub environment

Production signing additionally requires verified MFA for every GitHub and
SignPath member with signing access, a protected signing-approval permission
separate from ordinary source-write operations, and signing credentials that
are available only to the protected workflow. These controls are requirements,
not claims that the pending SignPath path has already been configured.

Repository settings must configure `stable-release` with required reviewers;
merely naming an environment in YAML does not create an approval policy. A
GitHub immutable releases must remain enabled, and the active release-tag
ruleset must prevent deletion or force-update of `v*` tags without bypass.

GitHub jobs additionally require:

- `contents: write` to create global RC/stable releases and the stable tag
- `id-token: write` for keyless cosign and npm provenance

### Pending RC credential decision

RC currently proves registry-ready package bytes locally and performs no
registry authentication or mutation. Before the first RC, decide whether RC
must also exercise real, read-only npm/crates.io/buf.build credential checks.
Do not simulate a successful permission check and do not publish final package
versions merely to test credentials; first registry writes remain stable-only
unless that policy is explicitly changed.

## Post-release Verification

- `npm view @nimiplatform/nimi version`
- `npm view @nimiplatform/sdk version`
- `npm view @nimiplatform/kit version`
- `npm view @nimiplatform/app-tools version`
- `cargo search nimi-shell-protected-local --limit 1`
- `cargo search nimi-shell-tauri --limit 1`
- Verify the Proto module on buf.build.
- Verify `/runtime/latest.json` resolves the global stable release and all six
  Runtime archives.
- Install one supported Runtime npm package and run `nimi version --json`.
- Verify the GitHub stable release includes `checksums.txt`, Runtime SPDX SBOMs,
  and `.sig` / `.pem` pairs for every signed Runtime file.

Verify a Runtime file with:

```bash
cosign verify-blob \
  --certificate <artifact>.pem \
  --signature <artifact>.sig \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp 'https://github.com/<org>/<repo>/.github/workflows/release-candidate.yml@.*' \
  <artifact>
```

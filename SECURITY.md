# Security Policy

## Supported Versions

Security fixes are provided for the latest `main` branch and the newest tagged release line.

## Reporting a Vulnerability

Do not open public issues for security reports.

Use one of the following channels:

- [GitHub Security Advisory](https://github.com/nimiplatform/nimi/security/advisories/new)
  (preferred): open a private report in this repository.
- Email: [`security@nimi.ai`](mailto:security@nimi.ai)

Include:

- affected component (`runtime`, `sdk`, `desktop`, `proto`, `web`)
- reproduction steps or proof of concept
- impact assessment
- suggested mitigation if available

## Response SLA

- Initial acknowledgement: within 72 hours
- Triage result: within 7 calendar days
- Fix timeline: depends on severity and exploitability

## Disclosure

After mitigation is available, we coordinate responsible disclosure and publish a security note in release notes/changelog.

## Signed Artifact Verification

Windows production signing is not active. The SignPath Foundation application
has not yet been submitted. As checked on 2026-10-10, the public
[GitHub Releases API](https://api.github.com/repos/nimiplatform/nimi/releases)
returns no releases, and the claimed `v0.2.2-preview.1` prerelease is unavailable.
Earlier developer previews were withdrawn, as recorded in [README.md](README.md).
The unsigned Runtime bootstrap remains a planned application prerequisite;
its build script is not evidence of a published artifact. There is no production
Authenticode signer configured and no current Nimi
Windows artifact should be treated as production signed or SignPath-signed. The
repository's self-signed development certificate path is for local testing only
and is never a release-signing substitute.

Explicit `vX.Y.Z-preview.N` GitHub prereleases are intended as unsigned previews,
not RC or Stable releases. A future unsigned Windows Runtime bootstrap must
report `NotSigned` when inspected on Windows. Its portable ZIP is intended to
contain no Nimi Home app, installer or service package. Preview assets must be
marked `UNSIGNED PREVIEW — NOT PROMOTABLE`, must not update `latest`, and must
never be retroactively described as signed. No unavailable preview asset's
contents or signature status should be treated as currently verified.

The current [Runtime bootstrap build script](scripts/build-windows-runtime-unsigned-bootstrap.mjs)
stages `nimi.exe`, Runtime's Apache-2.0 license and explicit bootstrap instructions.
Runtime also embeds third-party source and notices, including the
[LocateAnything loader](runtime/internal/engine/assets/locateanything_loader/NOTICE.md),
and links third-party Go libraries. The package-root license alone is not a
complete distribution license inventory; the actual payload and applicable
third-party attribution requirements need review before publication.
The bootstrap has no installer or service path. A user would extract
it, run `.\nimi.exe version --json`, and remove it by closing the process and
deleting the extracted directory. It does not modify `PATH`, Program Files,
ProgramData, or Windows certificate stores, and it does not make protected-local
production available.

The planned initial SignPath application scope is only the Nimi-maintained
Windows x64 Runtime executable `nimi.exe`, distributed in a portable ZIP;
Desktop installers, third-party Apps and separately acquired upstream binaries
are excluded from that signing target. This scope does not exempt embedded
third-party source, linked libraries or runtime-acquired dependencies from
license review. Under the [SignPath Foundation conditions](https://signpath.org/terms.html)
(checked 2026-10-10), eligibility depends on component licensing and source/build
ownership as well as an existing release in the form to be signed. The
LocateAnything source-channel ambiguity and the full dependency/distribution
inventory must be resolved before representing this artifact as eligible.
Nimi's signing identity is never used for a third-party App or upstream binary.
Authenticode on the Kit protected-local
`.node` addon is not a Phase 4A release gate; after SignPath approval, that
package consumes the leaf certificate SubjectPublicKeyInfo (SPKI) SHA-256 of
the formally signed Runtime solely for Runtime peer verification. The order is:
publish the explicit unsigned Runtime bootstrap, apply to SignPath Foundation,
receive approval and the project certificate, build and sign the formal
Runtime, derive that public SPKI digest, and only then publish the production
protected-local package.

The canonical [Code signing policy](https://nimi.ai/code-signing) describes the
planned signing scope and verification procedure. Release status and official
entry points are listed on the [Download page](https://nimi.ai/download). Until a
Windows artifact's Authenticode signature verifies successfully, do not infer a
Windows publisher identity from a release filename, checksum, SBOM, or cosign
blob signature. A cosign `.sig`/`.pem` pair authenticates the release blob; it
does not make an embedded `.exe` or `.node` file Authenticode-signed.

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
is waiting for the required public unsigned bootstrap release; there is no
production Authenticode signer configured, and no
current Nimi Windows artifact should be treated as production signed or
SignPath-signed. The repository's self-signed development certificate path is
for local testing only and is never a release-signing substitute.

Explicit `vX.Y.Z-preview.N` GitHub prereleases are unsigned previews, not RC or
Stable releases. The current Windows preview contains only the source-local Kit
native package, whose PE file must report `NotSigned`; it contains no Runtime,
installer, service, or Nimi App. The macOS candidate is ad-hoc signed with no
TeamIdentifier and requires the exact source checkout for installation and
uninstallation. Preview assets are marked `UNSIGNED PREVIEW — NOT PROMOTABLE`,
never update `latest`, and are never retroactively described as signed.

The next reviewed preview workflow is planned to add a portable unsigned
Windows x64 Runtime archive with `nimi.exe`, the Apache-2.0 license, and explicit
bootstrap instructions. This source change does not mean that archive has been
published: it becomes a current artifact only after the workflow runs and an
immutable GitHub prerelease is visible. The bootstrap has no installer or
service path. A user extracts it, runs `.\nimi.exe version --json`, and removes
it by closing the process and deleting the extracted directory. It does not
modify `PATH`, Program Files, ProgramData, or Windows certificate stores, and it
does not make protected-local production available.

The initial SignPath application scope is only the Nimi-owned Windows x64
Runtime executable `nimi.exe`. Nimi's signing identity is never used for a
third-party App or upstream binary. Authenticode on the Kit protected-local
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

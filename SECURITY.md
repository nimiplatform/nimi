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
is pending, there is no production Authenticode signer configured, and no
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

The canonical [Code signing policy](https://nimi.ai/code-signing) describes the
planned signing scope and verification procedure; that URL becomes public only
after the website changes are deployed. Release status and official entry
points are listed on the [Download page](https://nimi.ai/download). Until a
Windows artifact's Authenticode signature verifies successfully, do not infer a
Windows publisher identity from a release filename, checksum, SBOM, or cosign
blob signature. A cosign `.sig`/`.pem` pair authenticates the release blob; it
does not make an embedded `.exe` or `.node` file Authenticode-signed.

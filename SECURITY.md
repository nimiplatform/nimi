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

### Current Public Beta Release and Official Entry Points

Official installers and release status are available on the [Download page](https://nimi.ai/download) and [GitHub Releases](https://github.com/nimiplatform/nimi/releases). As verified on 2026-10-14, the immutable GitHub prerelease `nimi/v0.2.4` is published as a **Public Beta** on the `beta` channel, which is tracked independently from `stable` / `latest`.

- **Supported platforms and requirements**:
  - **macOS (`arm64`)**: `Nimi-0.2.4-macos-arm64.pkg` (`minimumOsVersion: 13.0`).
  - **Windows (`x86_64`)**: `Nimi-0.2.4-windows-amd64.exe` (`minimumOsVersion: 10.0.19041`, Windows 10 version 2004 or later).
  - Linux and Intel macOS are not supported full-product installer targets at this stage. Using Nimi requires a Nimi account with browser sign-in.
- **Installed components**: The installers deploy Desktop, Runtime, Avatar, and required system services/helpers into protected program locations while keeping user data separate from program files (with explicit authorization required for data deletion). For uninstallation or recovery details, follow the instructions and support channels accompanying the specific version you downloaded.
- **Tagging and channel identification**: Full-product releases use the `nimi/v<version>` tag format (component tags retain independent ownership). Because Beta tags do not necessarily carry a `-preview.N` suffix, always determine the release stage from the GitHub release flags and the signed `metadata.channel` field rather than filename or tag suffixes alone.

### Release Metadata and Platform Verification

The `nimi/v0.2.4` release publishes 7 release-owned assets: the macOS `.pkg` installer, the Windows `.exe` installer, build and update JSON manifests for both platforms, and the Windows installed inventory JSON.

- **Ed25519 update manifests**: In the 2026-10-14 check, both the macOS and Windows update manifests were verified against the repository's platform Ed25519 public key and passed schema and freshness checks (`channel: "beta"`), binding the exact installer SHA-256 digest, byte size, and cohort.
- **macOS signing expectations**: The release notes describe an admitted macOS `arm64` PKG, and the platform release pipeline requires Apple Developer ID signing, notarization, and stapling. (Manifest signature verification confirms release metadata integrity and does not replace OS-level signature verification on the downloaded binary.)
- **Windows unsigned Beta and `P-SUPD-012` trust model**: Windows production Authenticode signing is not active, and there is no confirmed formal SignPath signing integration. `Nimi-0.2.4-windows-amd64.exe` is explicitly distributed as an unsigned installer (`NotSigned`). Under `P-SUPD-012`, the Windows Public Beta establishes protected-local trust for Desktop, Runtime, Avatar, and Nimi App sessions through the combination of Ed25519-signed platform update metadata, the complete Windows installed inventory JSON, and protected `Program Files` ownership with locked-byte verification. An unsigned file (`NotSigned`) never grants privileges on its own.

### Certificates, Historical Previews, and Third-Party Scope

- **No development certificates required**: The current Public Beta does not require installing development root certificates or disabling OS security features. The repository's self-signed development certificate tooling is strictly for local source builds and is never used as a release-signing substitute. Any `Root` or `TrustedPublisher` certificate cleanup notes apply only to historical local development setups or withdrawn early previews.
- **Metadata vs. Authenticode**: Ed25519-signed release metadata and blob signatures authenticate release manifests and asset digests; they do not make an `.exe` or `.node` binary Windows Authenticode-signed. Until a Windows artifact carries a verified Authenticode signature, do not infer a Windows publisher identity from filenames or release metadata.
- **Signing boundaries and third-party notices**: Nimi's signing identity is never applied to third-party Apps or separately acquired upstream binaries. Runtime embeds and links third-party open-source components—including the [LocateAnything loader](runtime/internal/engine/assets/locateanything_loader/NOTICE.md) and Go libraries—which remain governed by their respective licenses and attribution notices. See the canonical [Code signing policy](https://nimi.ai/code-signing) for full policy details.

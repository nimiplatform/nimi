import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LanguageToggle } from '../landing/components/language-toggle.js';
import { withLocaleQuery } from '../landing/config/landing-links.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import { usePublicPageLocale } from './use-page-locale.js';

// @nimi-authority: rule.nimi.platform.core-protocol.p-arch-001a
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-positioning
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-owner-boundary
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-supported-completeness
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-028-release-tag-namespace
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-pkgrel-009
const REPOSITORY_URL = 'https://github.com/nimiplatform/nimi';
const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const SECURITY_ADVISORY_URL = `${REPOSITORY_URL}/security/advisories/new`;
const DOCS_URL = 'https://docs.nimi.ai';

type PageMeta = {
  title: string;
  description: string;
  canonical: string;
};

type SharedCopy = {
  skipToContent: string;
  backHome: string;
  download: string;
  policy: string;
  source: string;
  docs: string;
  security: string;
  privacy: string;
  terms: string;
  language: string;
  english: string;
  chinese: string;
  switchEnglish: string;
  switchChinese: string;
  currentStatus: string;
  reviewed: string;
  securityAdvisoryDetail: string;
  securityEmailDetail: string;
};

type TextSection = {
  title: string;
  paragraphs: ReadonlyArray<string>;
  items?: ReadonlyArray<string>;
};

type DownloadCopy = {
  meta: PageMeta;
  kicker: string;
  title: string;
  intro: string;
  statusTitle: string;
  statusBody: string;
  releaseAction: string;
  versions: TextSection & { cta: string };
  preview: {
    title: string;
    scope: string;
    warning: string;
    usage: string;
    releaseLink: string;
    detailsLink: string;
  };
  release: TextSection;
  platformTitle: string;
  platforms: ReadonlyArray<{
    name: string;
    status: string;
    detail: string;
  }>;
  prerelease: TextSection;
  sourceBuild: TextSection;
  verification: TextSection;
  providerTitle: string;
  providerLabel: string;
  attribution: string;
  disclaimer: string;
  systemChanges: TextSection;
  uninstall: TextSection;
  linksTitle: string;
};

type PolicyCopy = {
  meta: PageMeta;
  kicker: string;
  title: string;
  intro: string;
  statusTitle: string;
  statusBody: string;
  status: TextSection;
  attributionTitle: string;
  attributionIntro: string;
  attribution: string;
  attributionPending: string;
  scope: TextSection;
  upstream: TextSection;
  build: TextSection;
  team: TextSection;
  access: TextSection;
  metadata: TextSection;
  metadataBlocker: string;
  verificationTitle: string;
  verificationIntro: string;
  verificationChecks: ReadonlyArray<string>;
  privacy: TextSection;
  system: TextSection;
  uninstall: TextSection;
  historical: TextSection;
  incident: TextSection;
  license: TextSection;
};

type PublicPageCopy = {
  shared: SharedCopy;
  download: DownloadCopy;
  policy: PolicyCopy;
};

const EN_COPY: PublicPageCopy = {
  shared: {
    skipToContent: 'Skip to main content',
    backHome: 'Nimi home',
    download: 'Download',
    policy: 'Code signing policy',
    source: 'Source code',
    docs: 'Documentation',
    security: 'Security',
    privacy: 'Privacy Policy',
    terms: 'Terms',
    language: 'Language',
    english: 'English',
    chinese: '中文',
    switchEnglish: 'Switch language to English',
    switchChinese: 'Switch language to Chinese',
    currentStatus: 'Current status',
    reviewed: "Release status updated October 14, 2026",
    securityAdvisoryDetail: 'Private vulnerability report',
    securityEmailDetail: 'Private security contact',
  },
  download: {
    meta: {
      title: 'Download Nimi | Release status',
      description:
        'Download availability, product composition, and developer guidance for Nimi.',
      canonical: 'https://nimi.ai/download',
    },
    kicker: 'Release status',
    title: 'Download Nimi',
    intro:
      "Download the Nimi Public Beta for macOS arm64 and Windows x86_64, check system requirements, and learn how release verification works.",
    statusTitle: "Nimi v0.2.4 Public Beta is available",
    statusBody:
      "The Public Beta includes Nimi Home, Runtime, and Avatar. Choose the installer for your platform below. You’ll need a Nimi account and browser sign-in; this is a Beta release, so check its notes before installing.",
    releaseAction: "Download from GitHub Releases",
    versions: {
      title: 'How releases are identified',
      paragraphs: [
        "Release tags name their owner: nimi/v<version> for the complete Desktop + Runtime + Avatar product (such as the current public Beta nimi/v0.2.4), desktop/v<version> for a Desktop-only delivery, and runtime/v<version> for a Runtime-only delivery. Release stage is determined by the GitHub prerelease marker and signed metadata.channel (for example, channel=beta), not by a tag suffix alone.",
      ],
      items: [
        'Owner and version: match the release tag to the product or component you want.',
        'Platform: choose only an asset the release page lists for your platform.',
        "Verify before running: check the release-owned build and update metadata (SHA-256, size, channel, and Ed25519 signature) and the platform signing posture described on the release page and in the code signing policy.",
      ],
      cta: 'Check GitHub Releases',
    },
    preview: {
      title: "Try the Public Beta",
      scope: "Version 0.2.4 is available for Apple Silicon Macs and Windows x86_64. Each release includes its own installer files and verification metadata.",
      warning: "The Windows Beta installer has no Authenticode signature. Nimi uses signed release metadata and protected installation checks for this Beta. Do not install a development root certificate or turn off OS security controls to run it.",
      usage: "Open the official release page to choose your installer and read its notes. Earlier withdrawn previews have separate cleanup guidance below.",
      releaseLink: 'View GitHub Releases',
      detailsLink: "Installation and historical cleanup",
    },
    release: {
      title: 'Product and release details',
      paragraphs: [
        'Nimi is an open-source, local-first personal AI product comprising Desktop, Runtime, and Avatar. Nimi Home is its Desktop-hosted entry for conversations, characters, creations, stories, worlds, settings, and Nimi Apps. Runtime executes local or cloud AI capabilities; Avatar provides the desktop embodiment. Realm owns account and ecosystem identity.',
        "The beta channel and the stable (latest) channel are independent. Public Beta releases such as nimi/v0.2.4 are published as prereleases with channel=beta and are never promoted or represented as Stable or latest.",
        'The complete product uses nimi/v<version> releases. Desktop-only and Runtime-only deliveries use desktop/v<version> and runtime/v<version>; libraries retain their own package versions. Zhiyu and Nimi Lab are independently published Third-party Apps, not components of the Nimi installation.',
        "Nimi Apps use Registry packages, local package imports, or Developer Mode. App discovery, installation, updates, and access controls are supported on Windows x86_64 and macOS arm64; local-import end-to-end acceptance is tracked separately. Other platforms and ordinary App repair remain unavailable. Runtime checks the current session and admitted operations, with user choices governing the relevant install and resource access.",
      ],
    },
    platformTitle: 'Platform availability',
    platforms: [
      {
        name: 'Windows',
        status: "Public Beta (v0.2.4)",
        detail: "Nimi-0.2.4-windows-amd64.exe is available for Windows 10 version 2004 (10.0.19041) and later (x86_64). The Beta installer is unsigned (Authenticode NotSigned) and is accompanied by build metadata and Ed25519-signed update manifests and the Windows installed inventory JSON.",
      },
      {
        name: 'macOS',
        status: "Public Beta (v0.2.4)",
        detail: "Nimi-0.2.4-macos-arm64.pkg is available for Apple Silicon Macs running macOS 13.0 and later, with build metadata and Ed25519-signed update manifests. The release workflow requires Developer ID signing, notarization, and stapling for admitted macOS PKG assets; Intel Macs are not supported as a complete product platform.",
      },
      {
        name: 'Linux',
        status: "No product release",
        detail: "There is no official Nimi product installer for Linux (or Intel macOS). Ability to compile Runtime from source does not make those platforms supported product targets.",
      },
      {
        name: 'Source',
        status: 'Available for development',
        detail:
          'The public repository can be reviewed and built locally. Local output is not a Nimi production release and carries no production-signing claim.',
      },
    ],
    prerelease: {
      title: 'Pre-releases and explicit versions',
      paragraphs: [
        "Every release tag identifies its owner: nimi/v<version> for the complete Desktop + Runtime + Avatar product (such as nimi/v0.2.4), desktop/v<version> for Desktop, or runtime/v<version> for Runtime. Libraries use their own component prefix and version. A public Beta does not necessarily carry a -preview.N tag suffix; check the GitHub prerelease flag and the signed update manifest's channel field (for example, channel=beta).",
        "Beta prereleases remain separate from Stable and never appear as latest. The Windows x86_64 Beta installer in nimi/v0.2.4 is explicitly unsigned for Authenticode, and unsigned bytes are never renamed, retroactively signed, or promoted into RC or Stable releases.",
      ],
    },
    sourceBuild: {
      title: 'Source builds are different from releases',
      paragraphs: [
        "Local development builds may use a self-signed certificate for same-machine testing. That certificate is never a production identity, is never included in GitHub Release assets, and is not required or used by the public Beta installer.",
        "The former mixed-component preview workflow is retired. Official releases are built in GitHub Actions and bind the declared product or component tag to exact artifact SHA-256 digests, sizes, cohorts, and Ed25519-signed platform metadata.",
      ],
    },
    verification: {
      title: 'Release assets and verification',
      paragraphs: [
        "Public Beta nimi/v0.2.4 publishes 7 release assets: Nimi-0.2.4-macos-arm64.pkg, Nimi-0.2.4-windows-amd64.exe, macOS and Windows build metadata and update manifest JSON files, and the Windows installed inventory JSON. Both update manifests are signed with the repository's Ed25519 platform key and specify channel=beta, minimumOsVersion 13.0 for macOS, and 10.0.19041 (Windows 10 2004) for Windows, binding exact artifact SHA-256 hashes, file sizes, and cohorts.",
        "Platform-signed metadata (Ed25519) verifies release manifest integrity and artifact SHA-256 digests, but it is not Windows Authenticode. In nimi/v0.2.4, the Windows installer is unsigned for Authenticode; under P-SUPD-012, Windows unsigned Beta installations establish protected-local trust by verifying the Ed25519-signed platform metadata, the complete Windows installed inventory, and protected Program Files ownership and locked bytes. Arbitrary unsigned files or a bare NotSigned status never grant trust.",
        "For macOS arm64, the release workflow requires Developer ID signing, notarization, and stapling for the admitted PKG; verify the downloaded installer on your Mac alongside the release's build and update JSON files. The current Beta does not publish a separate standalone checksums text file or SBOM—use the release-owned metadata JSON assets for verification.",
      ],
      items: [
        "Source: download only from https://nimi.ai/download or https://github.com/nimiplatform/nimi/releases.",
        "Identity and channel: confirm the tag (such as nimi/v0.2.4), platform asset, minimum OS version, and metadata.channel (beta vs. stable).",
        "Metadata and signatures: verify the SHA-256 digest and file size against the Ed25519-signed update manifests (and Windows installed inventory), and check OS code-signing posture per the Code signing policy.",
      ],
    },
    providerTitle: 'Windows code signing',
    providerLabel: "Planned Windows code-signing provider (production signing not yet integrated)",
    attribution: 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    disclaimer:
      "The Windows Beta installer in nimi/v0.2.4 is unsigned for Authenticode. No Nimi artifact is SignPath-signed unless formal SignPath integration is confirmed and its Authenticode signature verifies successfully.",
    systemChanges: {
      title: "Installation, system changes, and historical builds",
      paragraphs: [
        "Current Public Beta (nimi/v0.2.4): The macOS arm64 PKG (Nimi-0.2.4-macos-arm64.pkg) and Windows x86_64 installer (Nimi-0.2.4-windows-amd64.exe) are full product installers—not portable ZIPs. They install Desktop, Runtime, Avatar, and the required system services and helper components into protected system locations (including Program Files on Windows).",
        "Windows Beta trust model (P-SUPD-012): Although the Windows Beta installer is unsigned for Authenticode, it establishes protected-local trust through Ed25519-signed platform metadata, the complete Windows installed inventory JSON, and protected Program Files ownership and locked-byte verification. It never installs a development self-signed certificate into Windows Root or TrustedPublisher stores and does not require disabling OS security features.",
        "User data separation: Runtime-managed models, dependencies, environments, app and account data, app/account-scoped caches, and configured logs/audit roots live under the user-selected nimi_data root, separate from installed program and service files. No independent shared cache root is defined.",
        "Runtime logging: Protected Runtime logs ordinary output to standard output and writes failure events to the OS log (such as Windows Event Log) on a best-effort basis. The configured nimi_data logs root should not be assumed to be a persistent system-service log file destination unless documented by your installed version.",
        "Historical withdrawn Windows previews: The retired source-local npm Kit package and the withdrawn portable Runtime bootstrap (.\\nimi.exe version --json) did not install Nimi Home, a Windows service, or certificates, and did not enable protected-local operation.",
        "Historical Windows development prototype: An earlier local-development service prototype wrote Runtime files under %ProgramFiles%\\Nimi\\Runtime\\versions, protected state under %ProgramData%\\Nimi\\Runtime\\Protected (including memory.db and repair-local-agent-chat.exe backups/sidecars), and created the LocalSystem service NimiRuntime.",
        "Historical development certificates (local-dev prototypes only): That earlier local-development Windows prototype imported a self-signed certificate into LocalMachine Root and TrustedPublisher for same-machine testing. This applies only to users who ran the historical local-development prototype—never to the public Beta nimi/v0.2.4 installer.",
        "Historical macOS development candidate: If you ran the earlier repo-assisted macOS development script, it used the development namespace _nimiruntimedev, ai.nimi.runtime.dev, /Applications/Nimi Dev.app, /Library/Application Support/Nimi/RuntimeDev, /usr/local/libexec/nimi-macos-dev-security, local Runtime sockets, and /private/var/run/nimi-macos-dev-security.lock.",
      ],
    },
    uninstall: {
      title: 'Uninstallation and cleanup',
      paragraphs: [
        "For uninstalling or recovering a Public Beta installation, use the guidance and official support for that exact release. Historical development-prototype cleanup commands below apply only to those older builds.",
        "User data (nimi_data): Program files and user data are separate. The user-selected nimi_data root is preserved by default; delete models, dependencies, environments, apps, accounts, scoped caches, or configured logs/audit roots only with explicit intent after backing up anything you want to keep. Deletion is irreversible.",
        "Historical Windows development prototype only: If you ran the earlier local-development service prototype, stop and delete the NimiRuntime service in an elevated shell, remove %ProgramFiles%\\Nimi\\Runtime, and choose whether to keep or remove %ProgramData%\\Nimi\\Runtime\\Protected (including memory.db and repair backups/sidecars).",
        "Historical local-development certificates only: If that earlier Windows development prototype installed a local self-signed certificate on your machine, remove it from LocalMachine Root and TrustedPublisher by its exact thumbprint. The Public Beta installer does not install a development certificate; its cleanup steps do not require removing one.",
        "Historical macOS development candidate only: For the earlier repo-assisted macOS development build, run node scripts/accept-runtime-fixed-service.mjs --uninstall from that exact source checkout to remove the development service, /Applications/Nimi Dev.app, helper, sockets, and _nimiruntimedev principal (the empty /private/var/run/nimi-macos-dev-security.lock file may remain until reboot).",
        "Historical withdrawn npm Kit and portable bootstrap: Remove the retired source-local Kit package with npm uninstall in that project. For the withdrawn portable Windows Runtime ZIP, close any running nimi.exe process and delete the extracted folder.",
      ],
    },
    linksTitle: 'Official links',
  },
  policy: {
    meta: {
      title: 'Code signing policy | Nimi',
      description:
        "Nimi code signing policy: current Public Beta signing and metadata verification posture, planned SignPath attribution, artifact scope, and release controls.",
      canonical: 'https://nimi.ai/code-signing',
    },
    kicker: 'Trust and release integrity',
    title: 'Code signing policy',
    intro:
      "This policy defines the code-signing and release-verification boundaries for artifacts built from the Nimi open-source repository. It explains how the current Public Beta (nimi/v0.2.4) establishes trust and distinguishes current controls from planned Windows Authenticode signing via SignPath.",
    statusTitle: "Public Beta verification and Windows signing status",
    statusBody:
      "The current Beta provides signed update manifests for macOS arm64 and Windows x86_64. Windows installers are published without Authenticode signing; they carry no SignPath signature.",
    status: {
      title: 'Status',
      paragraphs: [
        "On October 14, 2026, Nimi published the immutable public Beta prerelease nimi/v0.2.4 on GitHub Releases for macOS arm64 (Nimi-0.2.4-macos-arm64.pkg) and Windows x86_64 (Nimi-0.2.4-windows-amd64.exe). Both platforms publish build metadata, alongside update manifests verified under the repository's Ed25519 platform public key (channel=beta, minimum OS versions macOS 13.0 and Windows 10 10.0.19041). Formal SignPath Windows code-signing integration is not confirmed or active.",
        "Platform-signed metadata (Ed25519) binds the exact artifact SHA-256, size, and cohort, but it is not Windows Authenticode. The Windows x86_64 Beta installer in nimi/v0.2.4 is explicitly unsigned (NotSigned) and does not use or require any development self-signed certificate. Under P-SUPD-012, the Windows Beta establishes protected-local trust by verifying the Ed25519-signed platform metadata, the complete Windows installed inventory JSON, and protected Program Files ownership and locked bytes.",
        "For macOS arm64, the platform release workflow requires Apple Developer ID signing, notarization, and stapling for admitted PKG installers. On Windows, Authenticode-signed RC and Stable releases remain gated on connecting a formal production Authenticode signer. The beta channel remains independent from Stable, and arbitrary unsigned files or a bare NotSigned state never grant protected-local permissions.",
        'Until approval and production workflow integration are complete, Nimi will not imply that SignPath or SignPath Foundation has signed any artifact.',
      ],
    },
    attributionTitle: 'Planned attribution',
    attributionIntro:
      'If the application is approved and the production signing workflow is enabled, Nimi plans to use the following attribution:',
    attribution: 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    attributionPending:
      "This attribution applies only after formal SignPath approval and production signing workflow integration. Current Windows Beta artifacts in nimi/v0.2.4 are unsigned for Authenticode and carry no SignPath signature.",
    scope: {
      title: 'Scope of signed artifacts',
      paragraphs: [
        "The current Beta signs product update manifests with the platform Ed25519 key. The previously stated initial SignPath application scope remains the Nimi-owned Windows x86_64 Runtime executable nimi.exe; publishing the Beta does not expand that separate planned signing scope.",
        "While Windows Authenticode signing is not yet connected, the Windows Beta installer establishes protected-local trust through P-SUPD-012 (verified Ed25519 platform metadata, complete Windows installed inventory, and protected Program Files ownership/locked bytes). Nimi signs only its own reviewed public-source artifacts and never uses its signing identities to sign third-party Apps or upstream binaries.",
      ],
      items: [
        "Platform metadata signing (active in Beta): Ed25519-signed update manifests binding release installers, SHA-256 digests, sizes, cohorts, and the Windows installed inventory.",
        "Planned initial SignPath scope: the Nimi-owned Windows x86_64 Runtime executable nimi.exe.",
        "Third-party Apps, upstream binaries, installers, service helpers, repair helpers, and the Kit .node addon remain outside that initial SignPath request.",
      ],
    },
    upstream: {
      title: 'Third-party and upstream binaries',
      paragraphs: [
        "Nimi does not use its signing identity to sign third-party Apps or upstream binaries. Current Beta releases publish build/update metadata and the Windows installed inventory JSON rather than a standalone SBOM; future Authenticode-signed production releases will disclose included components through their accompanying license and SBOM materials.",
      ],
    },
    build: {
      title: 'Build origin and release process',
      paragraphs: [
        'The source repository is https://github.com/nimiplatform/nimi. GitHub Actions is the only production build system. Production signing does not accept arbitrary binaries uploaded from a developer workstation.',
        "Each release freezes the declared product or component version. Tags retain their owner prefix: nimi/v<version> for the complete Desktop + Runtime + Avatar product (such as nimi/v0.2.4), desktop/v<version> for Desktop, runtime/v<version> for Runtime, or the governed library prefix. Release stage is defined by the prerelease marker and signed metadata.channel (for example, channel=beta), not by tag suffix alone. Unsigned Windows Beta binaries are never promoted into Authenticode-signed RC or Stable releases.",
        "In the current Public Beta workflow, GitHub Actions builds the macOS arm64 PKG and Windows x86_64 installer, generates the platform build metadata and Windows installed inventory JSON, and signs the update manifests with the platform Ed25519 key. Unsigned Windows binaries are never retroactively signed or promoted into Stable.",
        'Every future SignPath signing request requires explicit human approval. Any production signing workflow and all build scripts must live with the source and be reviewed through the repository contribution process. The production SignPath workflow is not integrated today.',
      ],
    },
    team: {
      title: 'Team roles',
      paragraphs: [
        'Nimi is currently a single-maintainer open-source project supported by the registered company Nimi Network Limited.',
      ],
      items: [
        'Authors / Committers: @snowzane authors and commits project changes.',
        'Reviewers: @snowzane reviews external contributions before merge.',
        'Signing Approvers: @snowzane is the designated sole signing approver; no production signing request can be made while the provider and protected workflow remain unavailable.',
        'Signing approval is an explicit release action. GitHub commit access alone does not approve a signing request, even while the same sole maintainer currently holds both responsibilities.',
      ],
    },
    access: {
      title: 'MFA and access control',
      paragraphs: [
        'The GitHub organization currently enforces MFA for its members. SignPath access has not been granted; no future SignPath membership or production-signing access may be granted until MFA is enabled and verified for that member.',
        'Signing-approver assignment is distinct from ordinary contribution permission, and every request requires the signing approver to act explicitly. SignPath and GitHub tokens are never committed to the repository. Before production activation, any signing credential must be restricted to the protected workflow.',
        "The protected SignPath signing environment and its manual approval rule are not configured today. That missing enforcement blocks Authenticode-signed RC and Stable Windows releases (the current Windows Beta is published unsigned under P-SUPD-012).",
      ],
    },
    metadata: {
      title: 'Artifact identity and metadata',
      paragraphs: [
        "The Beta’s signed update manifest binds the product version, channel, platform, component cohort, installer digest and size, and compatibility requirements. Build metadata and the Windows installed inventory are separate release assets. Future Authenticode signing additionally requires the declared PE identity, SHA-256 signature, and RFC 3161 timestamp.",
        "For the current Beta, release admission requires schema-valid, fresh, Ed25519-verified update manifests and exact inventory/hash matching; the release does not publish a separate standalone checksums text file or SBOM. Before a future Authenticode-signed Stable Windows release is admitted, the workflow must also verify every Authenticode signature and publish SHA-256 checksums, an SBOM, and accompanying verification materials; any signer, version, or hash mismatch blocks publication.",
      ],
    },
    metadataBlocker:
      "Formal SignPath Windows Authenticode signing is not yet integrated. Until the Authenticode-signed workflow is implemented and verified, Windows Beta installers remain explicitly unsigned for Authenticode and rely on P-SUPD-012 metadata and inventory verification.",
    verificationTitle: 'Verification instructions',
    verificationIntro:
      "Verify any downloaded Nimi installer before running it. For the current Public Beta (nimi/v0.2.4), Nimi-0.2.4-windows-amd64.exe is expected to report Authenticode NotSigned; verify its SHA-256 digest and byte size against the Ed25519-signed Windows update manifest from the same release. When formal Windows Authenticode signing is enabled for future production releases, also require the Authenticode checks below.",
    verificationChecks: [
      "Current Beta: Ed25519 signature on the update manifest verifies against the repository's platform public key, with channel=beta.",
      "Future Authenticode-signed releases: Authenticode Status is Valid and Publisher is SignPath Foundation (only after formal SignPath enablement; current Windows Beta is NotSigned).",
      "The asset version, platform, and minimum OS version (macOS 13.0 or Windows 10.0.19041) match the release metadata.",
      "The installer and metadata files came from https://nimi.ai/download or https://github.com/nimiplatform/nimi/releases.",
      "The file's SHA-256 digest and byte size match the release-owned build and update metadata JSON files attached to that same release.",
    ],
    privacy: {
      title: 'Privacy and network behavior',
      paragraphs: [
        'Local-first does not mean never online. Local features and local Runtime execution process eligible work on the device. When a user explicitly selects a cloud provider, the request content and required metadata are sent to that provider under its terms.',
        'Realm and account operations send the information needed for authentication, account management, ecosystem identity, and selected synchronization to Nimi Realm services. Website analytics, cookies, logs, and browser storage are governed by the Privacy Policy.',
      ],
    },
    system: {
      title: 'System changes',
      paragraphs: [
        "Current Public Beta (nimi/v0.2.4): The Windows x86_64 installer (Nimi-0.2.4-windows-amd64.exe) and macOS arm64 package (Nimi-0.2.4-macos-arm64.pkg) are full product installers rather than portable ZIPs. They install Desktop, Runtime, Avatar, and required system services/helpers into protected system locations (including Program Files on Windows).",
        "Windows Beta trust model (P-SUPD-012): The Windows Beta installer establishes protected-local trust by verifying Ed25519-signed platform metadata, the complete Windows installed inventory JSON, and protected Program Files ownership and locked bytes. It does not import any development self-signed certificate into LocalMachine Root or TrustedPublisher and does not require disabling OS security controls.",
        "User data separation: Models, dependencies, environments, app/account data, app/account-scoped cache data, and configured logs/audit roots are stored under the user-selected nimi_data root, separate from installed program files. No independent shared cache root is defined.",
        "Runtime logging: Protected Runtime emits ordinary logs to standard output and writes failure events to the OS log (such as Windows Event Log) on a best-effort basis. The configured nimi_data logs root is not claimed here as an observed persistent service log file destination.",
        "Historical withdrawn portable bootstrap: The earlier withdrawn portable Windows Runtime ZIP (.\\nimi.exe version --json) had no installer or service, did not modify Program Files, ProgramData, PATH, or certificate stores, and did not enable protected-local operation.",
        "Historical Windows local-development prototype: An earlier local-development service prototype wrote Runtime versions under %ProgramFiles%\\Nimi\\Runtime\\versions, protected state under %ProgramData%\\Nimi\\Runtime\\Protected (with repair-local-agent-chat.exe backups/sidecars for memory.db), created the LocalSystem service NimiRuntime, and imported a local self-signed certificate into LocalMachine Root and TrustedPublisher. That self-signed certificate behavior applies only to the historical local-development prototype and never to public releases.",
      ],
    },
    uninstall: {
      title: 'Uninstallation',
      paragraphs: [
        "For uninstalling or recovering a Public Beta installation, use the guidance and official support for that exact release. Historical development-prototype cleanup commands below apply only to those older builds.",
        "User data (nimi_data): The user-selected nimi_data root is preserved by default and is separate from program files. Delete its models, dependencies, environments, apps, accounts, scoped caches, or configured logs/audit roots only with explicit user intent after backing up needed data; deletion is irreversible.",
        "Historical Windows development prototype only: If you ran the earlier local-development service prototype, use an elevated PowerShell session to stop and delete the NimiRuntime service, remove %ProgramFiles%\\Nimi\\Runtime, and choose whether to preserve or remove %ProgramData%\\Nimi\\Runtime\\Protected (including memory.db and repair backups/sidecars). If that prototype installed a local-development certificate, remove it from LocalMachine Root and TrustedPublisher by its exact thumbprint (not applicable to Public Beta users).",
        "Historical withdrawn previews: If you downloaded the withdrawn portable Windows Runtime ZIP, close any running nimi.exe process and delete the extracted folder. For the retired source-local npm Kit package, run npm uninstall in that project.",
      ],
    },
    historical: {
      title: 'Historical unsigned releases',
      paragraphs: [
        "Earlier mixed repository-wide preview releases were withdrawn. Current public Beta releases use explicit product tags (such as nimi/v0.2.4) and signed platform metadata (channel=beta) to declare their exact scope and assets. Unsigned Windows Beta binaries are never described retroactively as Authenticode-signed and never become RC or Stable assets.",
        "Windows Authenticode status is determined per file through Authenticode verification, while release manifest integrity and channel assignment are verified through the release's Ed25519-signed metadata—never inferred from version strings, filenames, or publication dates alone.",
      ],
    },
    incident: {
      title: 'Revocation and incident response',
      paragraphs: [
        'SignPath Foundation or the project may revoke signing authorization after misuse, policy violation, or credential compromise. On a suspected signing incident, Nimi stops distribution, removes affected artifacts, investigates the release path, and publishes a security advisory before restoring distribution.',
        'Report signing or security concerns privately through GitHub Security Advisories or security@nimi.ai.',
      ],
    },
    license: {
      title: 'License and source boundary',
      paragraphs: [
        'Nimi-owned Windows artifacts in signing scope are built from the public repository code covered by OSI-approved Apache-2.0 or MIT licenses. The private Realm implementation is not in this public repository and is not included in signed Windows artifacts.',
        "Documentation and specification content uses its own content license and is not represented as the binary software license. Third-party components and their licenses remain separately governed and disclosed through the repository's license materials (and accompanying SBOM materials in future signed production releases).",
      ],
    },
  },
};

const ZH_COPY: PublicPageCopy = {
  shared: {
    skipToContent: '跳转到主要内容',
    backHome: 'Nimi 首页',
    download: '下载',
    policy: '代码签名政策',
    source: '源代码',
    docs: '文档',
    security: '安全报告',
    privacy: '隐私政策',
    terms: '服务条款',
    language: '语言',
    english: 'English',
    chinese: '中文',
    switchEnglish: '切换语言为英文',
    switchChinese: '切换语言为中文',
    currentStatus: '当前状态',
    reviewed: "发布状态更新于 2026 年 10 月 14 日",
    securityAdvisoryDetail: '私下提交漏洞',
    securityEmailDetail: '私下安全联系',
  },
  download: {
    meta: {
      title: '下载 Nimi | 发布状态',
      description: 'Nimi 下载可用状态、产品组成与开发者说明。',
      canonical: 'https://nimi.ai/download',
    },
    kicker: '发布状态',
    title: '下载 Nimi',
    intro:
      "获取面向 macOS arm64 与 Windows x86_64 的 Nimi 公开 Beta 安装包，查看系统要求与版本校验方式。",
    statusTitle: "Nimi v0.2.4 公开 Beta 已开放下载",
    statusBody:
      "公开 Beta 包含 Nimi Home、Runtime 与 Avatar。请选择适合你设备的安装包，并在安装前阅读版本说明。使用 Nimi 需要 Nimi 账号并在浏览器中登录，当前发布仍处于 Beta 阶段。",
    releaseAction: "前往 GitHub Releases 下载",
    versions: {
      title: '如何识别版本',
      paragraphs: [
        "Release 标签标明归属：完整 Desktop + Runtime + Avatar 产品使用 nimi/v<version>（如当前公开 Beta nimi/v0.2.4），仅 Desktop 使用 desktop/v<version>，仅 Runtime 使用 runtime/v<version>。发布阶段由 GitHub prerelease 标记与签名元数据中的 metadata.channel（例如 channel=beta）决定，不能仅凭标签后缀判断。",
      ],
      items: [
        '归属与版本：确认 Release 标签对应你需要的产品或组件。',
        '平台：只选择版本页为你的平台列出的制品。',
        "运行前先验证：核对版本自带的构建与更新元数据（SHA-256、文件大小、通道与 Ed25519 签名）以及版本页和代码签名政策说明的平台签名状态。",
      ],
      cta: '查看 GitHub Releases',
    },
    preview: {
      title: "体验公开 Beta",
      scope: "0.2.4 现已支持 Apple Silicon Mac 与 Windows x86_64。每个版本都附有对应的安装包和校验元数据。",
      warning: "Windows Beta 安装包尚无 Authenticode 签名；本次 Beta 通过签名发布元数据与受保护安装校验建立信任。请勿为此安装开发根证书或关闭系统安全防护。",
      usage: "前往官方版本页选择安装包并查看说明。若曾安装已撤回的旧预览，请参阅下方单独的历史清理指引。",
      releaseLink: '查看 GitHub Releases',
      detailsLink: "安装与历史版本清理",
    },
    release: {
      title: '产品与发布详情',
      paragraphs: [
        'Nimi 是由 Desktop、Runtime 和 Avatar 组成的开源、本地优先个人 AI 产品。Nimi Home 是由 Desktop 承载的入口，将对话、角色、创作、故事、世界、设置与 Nimi Apps 连接在一起。Runtime 执行本地或云端 AI 能力，Avatar 提供桌面形象，Realm 负责账号与生态身份。',
        "beta 通道与 stable（latest）稳定通道相互独立。nimi/v0.2.4 等公开 Beta 作为 prerelease 发布（channel=beta），不会等同于或直接晋升为稳定版（Stable / latest）。",
        '完整产品使用 nimi/v<版本> 发布；单独的 Desktop 和 Runtime 分别使用 desktop/v<版本>、runtime/v<版本>，各库保持自己的包版本。Zhiyu 和 Nimi Lab 是独立发布的第三方 App，不属于 Nimi 安装包。',
        "Nimi App 有 Registry 包、本地包导入与开发者模式三种接入路径。目前应用发现、安装、更新与访问控制支持 Windows x86_64 与 macOS arm64，本地导入的整体验收另行确认；其他平台与普通 App 修复仍不可用。Runtime 按当前会话与已接纳操作检查访问，相关安装与资源使用遵循用户选择。",
      ],
    },
    platformTitle: '平台可用性',
    platforms: [
      {
        name: 'Windows',
        status: "公开 Beta（v0.2.4）",
        detail: "已提供面向 Windows 10 2004（10.0.19041）及更高版本（x86_64）的 Nimi-0.2.4-windows-amd64.exe。当前 Beta 安装程序为未签名状态（Authenticode NotSigned），随附build 元数据与经 Ed25519 签名的 update 清单与 Windows installed inventory JSON。",
      },
      {
        name: 'macOS',
        status: "公开 Beta（v0.2.4）",
        detail: "已提供面向 Apple Silicon（macOS 13.0 及更高版本）的 Nimi-0.2.4-macos-arm64.pkg，随附build 元数据与经 Ed25519 签名的 update 清单。平台发行流程要求准入的 macOS PKG 完成 Developer ID 签名、公证与票据钉合（staple）；Intel Mac 不在完整产品支持范围内。",
      },
      {
        name: 'Linux',
        status: "无完整产品发布",
        detail: "Linux（及 Intel macOS）目前没有官方 Nimi 完整产品安装包。Runtime 源码可编译不代表完整产品支持对应平台。",
      },
      {
        name: '源代码',
        status: '可用于开发',
        detail: '公开仓库可以审查和本地构建；本地产物不是 Nimi production release，也不具备 production-signing 身份。',
      },
    ],
    prerelease: {
      title: '预发布与指定版本',
      paragraphs: [
        "所有发布标签均须标明归属：完整 Desktop + Runtime + Avatar 产品使用 nimi/v<version>（例如 nimi/v0.2.4），Desktop 使用 desktop/v<version>，Runtime 使用 runtime/v<version>，各库使用独立的组件前缀与版本。公开 Beta 标签不一定带有 -preview.N 后缀，请以 GitHub prerelease 标记及签名 update manifest 中的 channel 字段（如 channel=beta）为准。",
        "Beta 预发布版本与稳定版严格分离，不会进入 latest。nimi/v0.2.4 中的 Windows x86_64 Beta 安装包明确为 Authenticode 未签名状态；未签名二进制绝不会通过改名、事后补签或直接晋升成为 RC 或 Stable 版本。",
      ],
    },
    sourceBuild: {
      title: '源码构建不同于正式发布',
      paragraphs: [
        "本地开发构建在单机测试时可能使用开发自签证书。该证书不代表生产身份，不会包含在 GitHub Release 制品中，当前公开 Beta 安装包也不使用或要求安装此类证书。",
        "早期混合组件的预览发布流程已停用。官方版本由 GitHub Actions 构建，将声明的产品或组件标签与精确的制品 SHA-256、文件大小、cohort 及平台 Ed25519 签名元数据绑定。",
      ],
    },
    verification: {
      title: 'Release 制品与验证',
      paragraphs: [
        "公开 Beta nimi/v0.2.4 共包含 7 个发布资产：Nimi-0.2.4-macos-arm64.pkg、Nimi-0.2.4-windows-amd64.exe、macOS 与 Windows 双平台的 build metadata 和 update manifest JSON，以及 Windows installed inventory JSON。两个平台的 update manifest 均在 2026 年 10 月 14 日核对时通过仓库平台公钥验签及格式、有效期校验，标明 channel=beta、最低系统版本 macOS 13.0 与 Windows 10.0.19041（Windows 10 2004），并绑定精确的制品 SHA-256、大小与 cohort。",
        "平台签名元数据（Ed25519）用于校验发布清单完整性与制品 SHA-256，但不等同于 Windows Authenticode 代码签名。nimi/v0.2.4 的 Windows 安装程序无 Authenticode 签名；根据 P-SUPD-012，Windows 未签名 Beta 通过校验平台 Ed25519 签名元数据、完整 Windows installed inventory 以及受保护 Program Files 所有权与锁定字节来建立受保护本地信任。单纯的 NotSigned 状态或任意未签名文件本身不会获得任何权限。",
        "在 macOS arm64 上，平台发行脚本要求准入的 PKG 完成 Developer ID 签名、公证与钉合（staple）；请在系统上结合版本自带的 build 与 update JSON 元数据核验下载的安装包。当前 Beta 未单独发布独立的 checksums 文本文件或 SBOM，请以 Release 自带的元数据 JSON 与资产为准。",
      ],
      items: [
        "来源：仅从官方下载页 https://nimi.ai/download 或 https://github.com/nimiplatform/nimi/releases 获取安装包。",
        "身份与通道：核对版本标签（如 nimi/v0.2.4）、适用平台资产、最低系统版本要求及 metadata.channel（beta 或 stable）。",
        "元数据与签名：对照经 Ed25519 签名的 update 清单核验 SHA-256 与文件大小，并按代码签名政策检查系统签名状态。",
      ],
    },
    providerTitle: 'Windows 代码签名',
    providerLabel: "计划中的 Windows 代码签名服务商（尚未确认接入正式签名）",
    attribution: 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    disclaimer: "nimi/v0.2.4 的 Windows Beta 安装包无 Authenticode 签名。在确认接入正式 SignPath 签名且文件的 Authenticode 签名验证通过前，任何 Nimi 制品均不属于 SignPath 签名制品。",
    systemChanges: {
      title: "安装变更、数据目录与历史构建说明",
      paragraphs: [
        "当前公开 Beta（nimi/v0.2.4）：macOS arm64 安装包（Nimi-0.2.4-macos-arm64.pkg）与 Windows x86_64 安装程序（Nimi-0.2.4-windows-amd64.exe）均为完整产品安装程序，而非便携式 ZIP。它们会安装 Desktop、Runtime、Avatar 以及运行所需的系统服务与辅助程序，并写入受保护的系统目录（包括 Windows 上的 Program Files）。",
        "Windows Beta 信任机制（P-SUPD-012）：尽管当前 Windows Beta 安装程序未进行 Authenticode 签名，系统会通过平台 Ed25519 签名元数据、完整的 Windows installed inventory JSON，以及受保护 Program Files 目录所有权与锁定字节校验来建立受保护本地信任。安装过程绝不会向系统 Root 或 TrustedPublisher 证书库导入开发自签证书，也不要求关闭操作系统安全功能。",
        "用户数据与程序分离：由 Runtime 管理的模型、依赖、运行环境、应用与账号数据、应用/账号范围内的缓存，以及配置的 logs/audit 根目录均存放在用户选定的 nimi_data 根目录下，与程序和系统服务文件分离。当前目录配置不设独立的共享缓存（shared cache）根目录。",
        "Runtime 日志行为：受保护的 Runtime 默认将常规日志输出至标准输出，并尽力将故障事件写入系统日志（如 Windows Event Log）。除非所安装版本的说明另有注明，不应将配置中的 nimi_data logs 根目录视为已验证的系统服务持久化日志文件目标。",
        "历史已撤回的 Windows 预览：早期已停用的源码本地 npm Kit 包与已撤回的便携式 Runtime 启动包（.\\nimi.exe version --json）不会安装 Nimi Home、Windows 服务或证书，也不支持受保护本地运行。",
        "历史 Windows 本地开发原型：早期的本地开发服务原型会将 Runtime 版本写入 %ProgramFiles%\\Nimi\\Runtime\\versions，将受保护状态写入 %ProgramData%\\Nimi\\Runtime\\Protected（含 memory.db 及 repair-local-agent-chat.exe 生成的备份与 sidecar 文件），并创建 LocalSystem 服务 NimiRuntime。",
        "历史开发自签证书说明（仅限本地开发原型）：上述早期本地开发原型曾为单机测试将开发自签证书导入 LocalMachine Root 与 TrustedPublisher。此情况仅涉及运行过历史本地开发原型的开发者，与公开 Beta（nimi/v0.2.4）安装包完全无关。",
        "历史 macOS 开发候选：若此前运行过仓库辅助的早期 macOS 开发脚本，其开发命名空间包含 _nimiruntimedev、ai.nimi.runtime.dev、/Applications/Nimi Dev.app、/Library/Application Support/Nimi/RuntimeDev、/usr/local/libexec/nimi-macos-dev-security、本地 Runtime sockets 及 /private/var/run/nimi-macos-dev-security.lock。",
      ],
    },
    uninstall: {
      title: '卸载与清理',
      paragraphs: [
        "卸载或恢复公开 Beta 时，请参照对应版本的说明与官方支持。下方开发原型的历史清理命令仅适用于那些旧构建。",
        "用户数据（nimi_data）：程序文件与用户数据相互独立。用户选定的 nimi_data 根目录默认保留；仅在确认并备份所需内容后，才应根据明确意愿删除其中的模型、依赖、环境、应用、账号、范围缓存或 logs/audit 目录。数据删除不可恢复。",
        "仅限历史 Windows 本地开发原型：若此前运行过早期本地开发服务原型，需在管理员终端中停止并删除 NimiRuntime 服务，移除 %ProgramFiles%\\Nimi\\Runtime，再自行决定保留或删除 %ProgramData%\\Nimi\\Runtime\\Protected（含 memory.db 与修复备份/sidecar 文件）。",
        "仅限历史本地开发自签证书：若早期 Windows 本地开发原型曾在测试机上导入开发自签证书，请按精确指纹（thumbprint）从 LocalMachine Root 与 TrustedPublisher 中移除。公开 Beta（nimi/v0.2.4）用户不会安装该证书，无需执行此操作。",
        "仅限历史 macOS 开发候选：针对早期仓库辅助的 macOS 开发构建，请从对应源码检出目录执行 node scripts/accept-runtime-fixed-service.mjs --uninstall，以移除开发服务、/Applications/Nimi Dev.app、辅助程序、sockets 与 _nimiruntimedev 账户（空的 /private/var/run/nimi-macos-dev-security.lock 锁文件可能保留至重启，不含用户数据）。",
        "历史已撤回的 npm Kit 与便携启动包：早期源码本地 Kit 包可在对应项目中通过 npm uninstall 移除；早期便携式 Windows Runtime 解压包只需关闭运行中的 nimi.exe 进程并删除解压目录即可。",
      ],
    },
    linksTitle: '官方入口',
  },
  policy: {
    meta: {
      title: 'Code signing policy | Nimi',
      description: "Nimi 代码签名政策：当前公开 Beta 的签名与元数据校验机制、计划中的 SignPath 归属、签名范围、发布控制与验证方法。",
      canonical: 'https://nimi.ai/code-signing',
    },
    kicker: '信任与发布完整性',
    title: 'Code signing policy',
    intro: "本政策定义由 Nimi 开源仓库构建的发布制品的代码签名与校验边界，说明当前公开 Beta（nimi/v0.2.4）的信任建立方式，并将现行机制与计划接入的 SignPath Windows Authenticode 签名明确区分。",
    statusTitle: "公开 Beta 校验与 Windows 签名状态",
    statusBody: "当前 Beta 为 macOS arm64 与 Windows x86_64 提供签名更新清单。Windows 安装包尚无 Authenticode 签名，也没有 SignPath 签名。",
    status: {
      title: 'Status',
      paragraphs: [
        "2026 年 10 月 14 日，Nimi 在官方 GitHub Releases 发布了不可变公开 Beta 预发布版 nimi/v0.2.4，提供 macOS arm64（Nimi-0.2.4-macos-arm64.pkg）与 Windows x86_64（Nimi-0.2.4-windows-amd64.exe）安装包。双平台均随附build metadata，以及经仓库平台 Ed25519 公钥验签的 update manifest（channel=beta，最低系统版本分别为 macOS 13.0 与 Windows 10 10.0.19041）。目前尚无已确认接入的正式 SignPath Windows 代码签名。",
        "平台签名元数据（Ed25519）严格绑定制品的精确 SHA-256、文件大小与 cohort，但不等同于 Windows Authenticode。nimi/v0.2.4 的 Windows x86_64 Beta 安装程序明确为未签名状态（NotSigned），且不使用或要求任何本地开发自签证书。根据 P-SUPD-012，Windows 未签名 Beta 通过校验平台 Ed25519 签名元数据、完整 Windows installed inventory JSON，以及受保护 Program Files 所有权与锁定字节来建立受保护本地信任。",
        "在 macOS arm64 平台，发行脚本要求准入的 PKG 安装包完成 Apple Developer ID 签名、公证与钉合（staple）。在 Windows 平台，具备 Authenticode 签名的 RC 与 Stable 正式版仍以接入正式生产签名服务为前提。beta 通道与 Stable 稳定通道相互独立，单纯的 NotSigned 状态或任意未签名文件本身绝不会获得受保护本地权限。",
        '在获批并接通 production workflow 前，Nimi 不会暗示任何制品已由 SignPath 或 SignPath Foundation 签名。',
      ],
    },
    attributionTitle: 'Planned attribution',
    attributionIntro: '如果申请获批并正式启用 production signing workflow，Nimi 计划使用以下归属语句：',
    attribution: 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    attributionPending: "上述归属声明仅在正式获批并接通 SignPath 生产签名工作流后适用。当前 nimi/v0.2.4 中的 Windows Beta 制品未进行 Authenticode 签名，不包含 SignPath 签名。",
    scope: {
      title: 'Scope of signed artifacts',
      paragraphs: [
        "当前 Beta 使用平台 Ed25519 密钥签署产品更新清单。此前公布的 SignPath 初始申请范围仍是 Nimi 自有的 Windows x86_64 Runtime 可执行文件 nimi.exe；Beta 发布不扩大这项独立的签名申请范围。",
        "在尚未接入 Windows Authenticode 签名期间，Windows Beta 安装包依据 P-SUPD-012 建立受保护本地信任（校验平台 Ed25519 签名元数据、完整 Windows installed inventory 以及受保护 Program Files 所有权与锁定字节）。Nimi 仅对经过审查的自有公开源码制品进行签名，绝不使用自身签名身份为第三方 App 或上游二进制文件签名。",
      ],
      items: [
        "平台元数据签名（当前 Beta 已启用）：使用 Ed25519 签署 update manifest，绑定安装包、SHA-256 摘要、文件大小、cohort 与 Windows installed inventory。",
        "计划中的 SignPath 初始范围：Nimi 自有的 Windows x86_64 Runtime 可执行文件 nimi.exe。",
        "第三方 App、上游二进制、安装程序、服务与修复辅助程序，以及 Kit .node 扩展，均不在该 SignPath 初始申请范围内。",
      ],
    },
    upstream: {
      title: '第三方与上游二进制',
      paragraphs: ["Nimi 不使用自己的签名身份为第三方 App 或上游二进制文件签名。当前公开 Beta 发布 build/update 元数据与 Windows installed inventory JSON，不单独附带独立 SBOM 文件；未来的生产级签名版本将通过随附的许可证与 SBOM 材料披露所含组件。"],
    },
    build: {
      title: 'Build origin and release process',
      paragraphs: [
        '源代码仓库是 https://github.com/nimiplatform/nimi。GitHub Actions 是唯一 production build system，production signing 不接受开发者工作站任意上传的二进制。',
        "每次发布均冻结所声明产品或组件的版本。标签保留归属前缀：完整 Desktop + Runtime + Avatar 产品为 nimi/v<version>（如 nimi/v0.2.4），Desktop 为 desktop/v<version>，Runtime 为 runtime/v<version>，各库使用各自受治理的组件前缀。发布阶段由 prerelease 标记与签名元数据中的 metadata.channel（如 channel=beta）决定，而非仅看标签后缀。未进行 Authenticode 签名的 Windows Beta 二进制文件绝不会直接晋升为已签名的 RC 或 Stable 版本。",
        "在当前公开 Beta 发布流程中，GitHub Actions 构建 macOS arm64 PKG 与 Windows x86_64 安装程序，生成平台 build metadata 与 Windows installed inventory JSON，并使用平台 Ed25519 密钥签署 update manifest。未签名的 Windows 二进制文件绝不会被追溯补签或直接晋升为稳定版。",
        '未来每次 SignPath signing request 都必须由人工明确批准。任何 production signing workflow 与全部 build scripts 都必须跟源码一起接受仓库 review；production SignPath workflow 当前尚未接入。',
      ],
    },
    team: {
      title: 'Team roles',
      paragraphs: ['Nimi 目前是由已注册主体 Nimi Network Limited 支持的单维护者开源项目。'],
      items: [
        'Authors / Committers：@snowzane 负责项目代码的创作与提交。',
        'Reviewers：@snowzane 在 merge 前审查外部贡献。',
        'Signing Approvers：@snowzane 是指定的唯一 signing approver；在 provider 与受保护 workflow 可用前，不存在可发起的 production signing request。',
        'Signing approval 是一次明确的 release 操作。GitHub commit 权限本身不等于批准 signing request；当前同一名维护者同时承担两个角色。',
      ],
    },
    access: {
      title: 'MFA and access control',
      paragraphs: [
        'GitHub 组织当前强制成员启用 MFA。SignPath access 尚未授予；未来任何 SignPath membership 或 production-signing access 都必须在该成员启用并验证 MFA 之后才能授予。',
        'Signing approver assignment 与普通 contribution permission 分开，每次请求均需 approver 明确操作。SignPath/GitHub token 不进入仓库；正式启用前，任何 signing credential 都必须限制在受保护 workflow 内。',
        "受保护的 SignPath 签名环境及其人工批准规则当前尚未配置；在完成配置前，具备 Authenticode 签名的 Windows RC 与 Stable 版本保持阻断（当前 Windows Beta 依 P-SUPD-012 以未签名安装包发布）。",
      ],
    },
    metadata: {
      title: 'Artifact identity and metadata',
      paragraphs: [
        "Beta 的签名更新清单绑定产品版本、通道、平台、组件组合、安装包摘要与大小，以及兼容性要求。构建元数据与 Windows 安装清单是另外的发布资产。后续 Authenticode 签名还需满足声明的 PE 身份、SHA-256 签名与 RFC 3161 时间戳要求。",
        "在当前 Beta 中，发布准入要求 update manifest 通过 schema、freshness 与平台公钥 Ed25519 验签，并与制品哈希和 installed inventory 精确匹配；当前版本不单独发布独立的 checksums 文本文件或 SBOM。在未来准入具备 Authenticode 签名的 Windows 稳定版前，工作流还必须在签名后复核所有 Authenticode 签名并发布 SHA-256 校验清单、SBOM 与配套校验材料；签名身份、版本或哈希任一不匹配均会阻断发布。",
      ],
    },
    metadataBlocker: "正式的 SignPath Windows Authenticode 签名工作流尚未接入。在该签名路径完成实现与验证前，Windows Beta 安装包保持明确的 Authenticode 未签名状态，并依据 P-SUPD-012 通过平台签名元数据与安装清单校验建立信任。",
    verificationTitle: 'Verification instructions',
    verificationIntro: "运行下载的 Nimi 安装包前请先完成校验。对于当前公开 Beta（nimi/v0.2.4），Nimi-0.2.4-windows-amd64.exe 的 Authenticode 状态预期为 NotSigned；请对照同一 Release 中经 Ed25519 签名的 Windows update 清单 核验其 SHA-256 摘要与字节大小。未来启用正式 Windows Authenticode 签名后，还需满足下列 Authenticode 校验项。",
    verificationChecks: [
      "当前 Beta：update manifest 的 Ed25519 签名可通过仓库平台公钥验证，且 channel=beta。",
      "未来 Authenticode 签名版本：Authenticode Status 为 Valid，且仅在正式启用 SignPath 后 Publisher 为 SignPath Foundation（当前 Windows Beta 为 NotSigned）。",
      "资产版本、平台及最低系统版本要求（macOS 13.0 或 Windows 10.0.19041）与发布元数据一致。",
      "安装包与元数据文件来自 https://nimi.ai/download 或 https://github.com/nimiplatform/nimi/releases。",
      "文件的 SHA-256 摘要与字节大小同该 Release 随附的 build 与 update 元数据 JSON 完全一致。",
    ],
    privacy: {
      title: 'Privacy and network behavior',
      paragraphs: [
        'Local-first 不等于永不联网。本地功能与本地 Runtime 会在设备上处理符合条件的任务；用户明确选择 cloud provider 后，请求内容与必要 metadata 会发送到该 provider，并受其条款约束。',
        'Realm/account 操作会向 Nimi Realm 服务发送完成认证、账号管理、生态身份和所选同步所需的信息。网站 analytics、cookies、日志和 browser storage 以 Privacy Policy 为准。',
      ],
    },
    system: {
      title: 'System changes',
      paragraphs: [
        "当前公开 Beta（nimi/v0.2.4）：Windows x86_64 安装程序（Nimi-0.2.4-windows-amd64.exe）与 macOS arm64 安装包（Nimi-0.2.4-macos-arm64.pkg）均为完整产品安装程序，而非便携式 ZIP。它们会将 Desktop、Runtime、Avatar 及所需系统服务/辅助程序安装至受保护的系统位置（包括 Windows 的 Program Files）。",
        "Windows Beta 信任机制（P-SUPD-012）：Windows Beta 安装包通过校验平台 Ed25519 签名元数据、完整 Windows installed inventory JSON 以及受保护 Program Files 所有权与锁定字节来建立受保护本地信任。它绝不会向 LocalMachine Root 或 TrustedPublisher 导入任何本地开发自签证书，也不要求关闭系统安全防护。",
        "用户数据分离：模型、依赖、运行环境、应用/账号数据、应用/账号范围内的缓存数据，以及配置中的 logs/audit 根目录均存放在用户选定的 nimi_data 根目录下，与已安装的程序文件分离；当前不设独立的共享缓存（shared cache）根目录。",
        "Runtime 日志：受保护的 Runtime 将常规日志输出到标准输出，并尽力将失败事件写入系统日志（如 Windows Event Log）。本政策不将配置中的 nimi_data logs 根目录声称为已验证的服务端持久化日志文件目标。",
        "历史已撤回的便携启动包：早期已撤回的便携式 Windows Runtime 解压包（.\\nimi.exe version --json）不包含安装程序或服务，不修改 Program Files、ProgramData、PATH 或证书库，也不支持受保护本地运行。",
        "历史 Windows 本地开发原型：早期仅供本地开发测试的服务原型会将 Runtime 版本写入 %ProgramFiles%\\Nimi\\Runtime\\versions，将受保护状态写入 %ProgramData%\\Nimi\\Runtime\\Protected（含针对 memory.db 的 repair-local-agent-chat.exe 备份与 sidecar 文件），创建 LocalSystem 服务 NimiRuntime，并将本地开发自签证书导入 LocalMachine Root 与 TrustedPublisher。导入开发自签证书仅存在于该历史本地开发原型中，绝不出现在公开版本中。",
      ],
    },
    uninstall: {
      title: 'Uninstallation',
      paragraphs: [
        "卸载或恢复公开 Beta 时，请参照对应版本的说明与官方支持。下方开发原型的历史清理命令仅适用于那些旧构建。",
        "用户数据（nimi_data）：用户选定的 nimi_data 根目录与程序文件分离且默认保留。仅在备份所需数据并由用户明确决定后，才可单独删除其中的模型、依赖、环境、应用、账号、范围缓存或 logs/audit 目录；删除操作不可恢复。",
        "仅限历史 Windows 本地开发原型：若此前运行过早期本地开发服务原型，请使用管理员 PowerShell 停止并删除 NimiRuntime 服务，删除 %ProgramFiles%\\Nimi\\Runtime，并决定保留或删除 %ProgramData%\\Nimi\\Runtime\\Protected（含 memory.db 及修复备份/sidecar 文件）。若该原型曾导入本地开发证书，请按精确 thumbprint 从 LocalMachine Root 与 TrustedPublisher 中移除（公开 Beta 安装包不安装开发证书，无需为卸载该安装包执行此操作）。",
        "历史已撤回预览：若下载过早期已撤回的便携式 Windows Runtime 解压包，关闭运行中的 nimi.exe 进程并删除解压文件夹即可；早期源码本地 npm Kit 包可在对应项目中执行 npm uninstall 移除。",
      ],
    },
    historical: {
      title: 'Historical unsigned releases',
      paragraphs: [
        "早期混装的仓库整体预览版本均已撤回。当前公开 Beta 使用明确的产品标签（如 nimi/v0.2.4）与平台签名元数据（channel=beta）声明其交付范围与资产。未进行 Authenticode 签名的 Windows Beta 二进制文件绝不会被追溯描述为已签名，也不会直接成为 RC 或 Stable 制品。",
        "Windows 文件的 Authenticode 签名状态须对单文件执行 Authenticode 验证判断，发布清单完整性与所属通道则通过版本随附的 Ed25519 签名元数据核验，均不能仅凭版本号字符串、文件名或发布日期推断。",
      ],
    },
    incident: {
      title: 'Revocation and incident response',
      paragraphs: [
        'SignPath Foundation 或项目可因滥用、违规或 credential compromise 撤销签名授权。发现签名异常时，Nimi 会停止分发、撤下受影响 artifact、调查 release path，并在恢复分发前发布 security advisory。',
        '请通过 GitHub Security Advisories 或 security@nimi.ai 私下报告签名或安全问题。',
      ],
    },
    license: {
      title: 'License and source boundary',
      paragraphs: [
        '进入签名范围的 Nimi 自有 Windows artifacts 由公开仓库中采用 OSI-approved Apache-2.0 或 MIT 许可证的代码构建。Realm 私有实现不在该公开仓库，也不进入已签名 Windows artifacts。',
        "文档与规范（Docs/spec）内容适用独立的内容许可证，不等同于二进制软件许可证。第三方组件及其许可证通过仓库的许可证材料（以及未来生产签名版本随附的 SBOM 材料）独立披露。",
      ],
    },
  },
};

export const PUBLIC_PAGE_CONTENT: Readonly<Record<LandingLocale, PublicPageCopy>> = {
  en: EN_COPY,
  zh: ZH_COPY,
};

function usePageMetadata(meta: PageMeta, locale: LandingLocale): void {
  useEffect(() => {
    const previousTitle = document.title;
    const previousLang = document.documentElement.lang;
    const targets = [
      ['meta[name="description"]', meta.description],
      ['meta[property="og:title"]', meta.title],
      ['meta[property="og:description"]', meta.description],
      ['meta[property="og:url"]', meta.canonical],
      ['meta[name="twitter:title"]', meta.title],
      ['meta[name="twitter:description"]', meta.description],
      ['link[rel="canonical"]', meta.canonical],
    ] as const;
    const previous = targets.map(([selector]) => {
      const element = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
      return {
        element,
        value: element instanceof HTMLMetaElement ? element.content : element?.getAttribute('href') ?? '',
      };
    });

    document.title = meta.title;
    document.documentElement.lang = locale;
    targets.forEach(([selector, value]) => {
      const element = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
      if (element instanceof HTMLMetaElement) element.content = value;
      else element?.setAttribute('href', value);
    });

    return () => {
      document.title = previousTitle;
      document.documentElement.lang = previousLang;
      previous.forEach(({ element, value }) => {
        if (element instanceof HTMLMetaElement) element.content = value;
        else element?.setAttribute('href', value);
      });
    };
  }, [locale, meta.canonical, meta.description, meta.title]);
}

function PageSection(props: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={props.id} className="release-section">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

function TextSectionContent({ section }: { section: TextSection }) {
  return (
    <>
      {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {section.items ? (
        <ul>
          {section.items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
    </>
  );
}

function OfficialLinks({ copy }: { copy: SharedCopy }) {
  return (
    <div className="release-link-grid">
      <a href={REPOSITORY_URL}>{copy.source}<span>{REPOSITORY_URL}</span></a>
      <a href={DOCS_URL}>{copy.docs}<span>{DOCS_URL}</span></a>
      <a href={SECURITY_ADVISORY_URL}>{copy.security}<span>{copy.securityAdvisoryDetail}</span></a>
      <a href="mailto:security@nimi.ai">security@nimi.ai<span>{copy.securityEmailDetail}</span></a>
      <Link to="/privacy">{copy.privacy}<span>nimi.ai/privacy</span></Link>
      <Link to="/code-signing">{copy.policy}<span>nimi.ai/code-signing</span></Link>
    </div>
  );
}

function PageShell(props: {
  locale: LandingLocale;
  onLocaleChange: (locale: LandingLocale) => void;
  meta: PageMeta;
  kicker: string;
  title: string;
  intro: string;
  statusTitle: string;
  statusBody: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const copy = PUBLIC_PAGE_CONTENT[props.locale].shared;
  usePageMetadata(props.meta, props.locale);

  return (
    <div
      className="release-page-shell"
      // See landing App.tsx: suppress native drag of selected text, which
      // hangs software-rendered environments. Selection and copy are intact.
      onDragStart={(event) => event.preventDefault()}
    >
      <a href="#release-main" className="skip-link">{copy.skipToContent}</a>
      <header className="release-header nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]">
        <div className="release-container release-header-inner">
          <Link to={withLocaleQuery('/', props.locale)} className="release-brand">
            <img src="/logo.svg" alt="" width="32" height="32" />
            <span>Nimi</span>
          </Link>
          <nav aria-label="Nimi public pages">
            <Link to={withLocaleQuery('/', props.locale)}>{copy.backHome}</Link>
            <Link to={withLocaleQuery('/download', props.locale)}>{copy.download}</Link>
            <Link to={withLocaleQuery('/code-signing', props.locale)}>{copy.policy}</Link>
          </nav>
          <LanguageToggle
            locale={props.locale}
            label={copy.language}
            options={{
              en: copy.english,
              zh: copy.chinese,
              switchToEn: copy.switchEnglish,
              switchToZh: copy.switchChinese,
            }}
            onChange={props.onLocaleChange}
          />
        </div>
      </header>

      <main id="release-main" className="release-container release-main">
        <div className="release-hero">
          <p className="release-kicker">{props.kicker}</p>
          <h1>{props.title}</h1>
          <p className="release-intro">{props.intro}</p>
          <aside className="release-status" aria-label={copy.currentStatus}>
            <span>{copy.currentStatus}</span>
            <strong>{props.statusTitle}</strong>
            <p>{props.statusBody}</p>
          </aside>
          {props.action}
          <p className="release-reviewed">{copy.reviewed}</p>
        </div>
        <article className="release-card">{props.children}</article>
      </main>

      <footer className="release-footer">
        <div className="release-container release-footer-inner">
          <span>Nimi Network Limited</span>
          <nav aria-label="Nimi policies">
            <a href={REPOSITORY_URL}>{copy.source}</a>
            <a href={DOCS_URL}>{copy.docs}</a>
            <a href={SECURITY_ADVISORY_URL}>{copy.security}</a>
            <Link to={withLocaleQuery('/privacy', props.locale)}>{copy.privacy}</Link>
            <Link to={withLocaleQuery('/terms', props.locale)}>{copy.terms}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function DownloadPage() {
  const [locale, setLocale] = usePublicPageLocale();
  return <DownloadPageView locale={locale} onLocaleChange={setLocale} />;
}

export function DownloadPageView({ locale, onLocaleChange }: {
  locale: LandingLocale;
  onLocaleChange: (locale: LandingLocale) => void;
}) {
  const page = PUBLIC_PAGE_CONTENT[locale].download;
  const shared = PUBLIC_PAGE_CONTENT[locale].shared;

  return (
    <PageShell
      locale={locale}
      onLocaleChange={onLocaleChange}
      meta={page.meta}
      kicker={page.kicker}
      title={page.title}
      intro={page.intro}
      statusTitle={page.statusTitle}
      statusBody={page.statusBody}
      action={(
        <section className="release-preview" aria-labelledby="preview-title">
          <h2 id="preview-title">{page.preview.title}</h2>
          <p id="preview-scope">{page.preview.scope}</p>
          <p id="preview-warning" className="release-warning">{page.preview.warning}</p>
          <p>{page.preview.usage}</p>
          <a className="release-primary-action" href={RELEASES_URL} aria-describedby="preview-scope preview-warning">
            {page.releaseAction}
          </a>
          <div className="release-preview-links">
            <a href={RELEASES_URL}>{page.preview.releaseLink}</a>
            <a href="#developer-details">{page.preview.detailsLink}</a>
          </div>
        </section>
      )}
    >
      <PageSection title={page.platformTitle}>
        <div className="release-platform-grid">
          {page.platforms.map((platform) => (
            <article key={platform.name}>
              <h3>{platform.name}</h3>
              <strong>{platform.status}</strong>
              <p>{platform.detail}</p>
            </article>
          ))}
        </div>
      </PageSection>

      <PageSection title={page.versions.title}>
        <TextSectionContent section={page.versions} />
        <a className="release-primary-action" href={RELEASES_URL}>{page.versions.cta}</a>
      </PageSection>

      <PageSection title={page.providerTitle}>
        <p className="release-label">{page.providerLabel}</p>
        <p><strong>{page.attribution}</strong></p>
        <p className="release-warning">{page.disclaimer}</p>
        <p><Link to={withLocaleQuery('/code-signing', locale)}>{shared.policy}</Link></p>
      </PageSection>

      <details className="release-details">
        <summary>{page.preview.detailsLink}</summary>
        {[page.verification, page.systemChanges, page.uninstall, page.prerelease, page.sourceBuild].map((section) => (
          <PageSection key={section.title} id={section === page.verification ? 'developer-details' : undefined} title={section.title}>
            <TextSectionContent section={section} />
          </PageSection>
        ))}
      </details>

      <details className="release-details">
        <summary>{page.release.title}</summary>
        <TextSectionContent section={page.release} />
      </details>

      <PageSection title={page.linksTitle}>
        <OfficialLinks copy={shared} />
      </PageSection>
    </PageShell>
  );
}

export function CodeSigningPolicyPage() {
  const [locale, setLocale] = usePublicPageLocale();
  const page = PUBLIC_PAGE_CONTENT[locale].policy;
  const shared = PUBLIC_PAGE_CONTENT[locale].shared;

  return (
    <PageShell
      locale={locale}
      onLocaleChange={setLocale}
      meta={page.meta}
      kicker={page.kicker}
      title={page.title}
      intro={page.intro}
      statusTitle={page.statusTitle}
      statusBody={page.statusBody}
    >
      <PageSection id="status" title={page.status.title}>
        <TextSectionContent section={page.status} />
      </PageSection>

      <PageSection id="planned-attribution" title={page.attributionTitle}>
        <p>{page.attributionIntro}</p>
        <p><strong>{page.attribution}</strong></p>
        <p className="release-warning">{page.attributionPending}</p>
      </PageSection>

      <PageSection id="scope" title={page.scope.title}>
        <TextSectionContent section={page.scope} />
      </PageSection>

      {[page.upstream, page.build].map((section) => (
        <PageSection key={section.title} title={section.title}>
          <TextSectionContent section={section} />
          {section === page.build ? <p><a href={REPOSITORY_URL}>{REPOSITORY_URL}</a></p> : null}
        </PageSection>
      ))}

      <PageSection id="team" title={page.team.title}>
        <TextSectionContent section={page.team} />
        <p><a href="https://github.com/snowzane">@snowzane on GitHub</a></p>
      </PageSection>

      <PageSection id="access" title={page.access.title}>
        <TextSectionContent section={page.access} />
      </PageSection>

      <PageSection id="metadata" title={page.metadata.title}>
        <TextSectionContent section={page.metadata} />
        <p className="release-warning">{page.metadataBlocker}</p>
      </PageSection>

      <PageSection id="verification" title={page.verificationTitle}>
        <p>{page.verificationIntro}</p>
        <h3>PowerShell</h3>
        <pre><code>Get-AuthenticodeSignature &lt;path&gt; | Format-List</code></pre>
        <h3>Windows SDK</h3>
        <pre><code>signtool verify /pa /all /v &lt;path&gt;</code></pre>
        <ul>
          {page.verificationChecks.map((check) => <li key={check}>{check}</li>)}
        </ul>
      </PageSection>

      <PageSection id="privacy" title={page.privacy.title}>
        <TextSectionContent section={page.privacy} />
        <p><Link to={withLocaleQuery('/privacy', locale)}>https://nimi.ai/privacy</Link></p>
      </PageSection>

      <PageSection id="system-changes" title={page.system.title}>
        <TextSectionContent section={page.system} />
      </PageSection>

      <PageSection id="uninstallation" title={page.uninstall.title}>
        <TextSectionContent section={page.uninstall} />
      </PageSection>

      {[page.historical, page.incident, page.license].map((section) => (
        <PageSection key={section.title} title={section.title}>
          <TextSectionContent section={section} />
          {section === page.incident ? (
            <p>
              <a href={SECURITY_ADVISORY_URL}>GitHub Security Advisories</a>
              {' · '}
              <a href="mailto:security@nimi.ai">security@nimi.ai</a>
            </p>
          ) : null}
        </PageSection>
      ))}

      <PageSection title={PUBLIC_PAGE_CONTENT[locale].download.linksTitle}>
        <OfficialLinks copy={shared} />
      </PageSection>
    </PageShell>
  );
}

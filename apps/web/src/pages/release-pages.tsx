import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LanguageToggle } from '../landing/components/language-toggle.js';
import {
  persistLocale,
  resolveInitialLocale,
  type LandingLocale,
  type StorageLike,
} from '../landing/i18n/locale.js';

// @nimi-authority: rule.nimi.platform.core-protocol.p-arch-001a
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-positioning
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-owner-boundary
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-supported-completeness
const REPOSITORY_URL = 'https://github.com/nimiplatform/nimi';
const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const UNSIGNED_BOOTSTRAP_RELEASE_URL = 'https://github.com/nimiplatform/nimi/releases/tag/v0.2.2-preview.1';
const UNSIGNED_BOOTSTRAP_ASSET_URL = 'https://github.com/nimiplatform/nimi/releases/download/v0.2.2-preview.1/Nimi-Runtime-v0.2.2-preview.1-windows-x64-unsigned-bootstrap.zip';
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
    reviewed: 'Repository status reviewed September 4, 2026',
    securityAdvisoryDetail: 'Private vulnerability report',
    securityEmailDetail: 'Private security contact',
  },
  download: {
    meta: {
      title: 'Download Nimi | Release status',
      description:
        'Stable release status and explicit unsigned-preview guidance for the open-source, local-first Nimi personal AI product.',
      canonical: 'https://nimi.ai/download',
    },
    kicker: 'Release status',
    title: 'Download Nimi',
    intro:
      'Nimi is an open-source, local-first, installable personal AI product. Nimi Home is its entry, Realm owns ecosystem identity, and Runtime executes local and cloud multi-provider AI. This page separates stable availability from explicit unsigned previews.',
    statusTitle: 'Stable release: Not yet available',
    statusBody:
      'No stable Nimi GitHub Release has been published. The immutable v0.2.2-preview.1 prerelease now provides an explicitly unsigned portable Windows x64 Runtime bootstrap; it is not promotable and never enters the stable latest path. Signed RC and Stable remain blocked until production platform signing is available.',
    releaseAction: 'Download unsigned Windows Runtime v0.2.2-preview.1',
    release: {
      title: 'Stable release status',
      paragraphs: [
        'Nimi Home brings conversations, characters, creations, stories, worlds, settings, and Nimi Apps into one personal AI product. Runtime executes the user-selected local or cloud AI capability while Realm owns account and ecosystem identity.',
        'The ordinary latest path is stable-only. It never treats a release candidate as the latest stable release.',
        'No platform currently has an official stable Nimi download. The immutable v0.2.2-preview.1 unsigned developer preview is available from GitHub Releases; it contains only the artifacts listed below and is not a standalone product installer.',
      ],
    },
    platformTitle: 'Platform availability',
    platforms: [
      {
        name: 'Windows',
        status: 'Unsigned Runtime bootstrap available',
        detail:
          'The immutable v0.2.2-preview.1 prerelease contains a portable unsigned Windows x64 Runtime bootstrap and a separate source-local Kit native package. It contains no Nimi Home app, installer, Windows service package, or protected-local production release.',
      },
      {
        name: 'macOS',
        status: 'Repo-assisted unsigned candidate',
        detail:
          'The ad-hoc candidate has no Apple TeamIdentifier, Developer ID signature, or notarization. Installation and uninstallation require an exact source checkout of the candidate commit; CI exercises that repo-assisted lifecycle, so this is not a standalone installer, RC, or stable release.',
      },
      {
        name: 'Linux',
        status: 'No preview asset',
        detail: 'The unsigned developer preview publishes no Linux Runtime archive or Nimi app. There is no official stable Linux release.',
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
        'An unsigned preview is accessible only through its explicit immutable vX.Y.Z-preview.N tag and GitHub prerelease page. It is marked UNSIGNED PREVIEW — NOT PROMOTABLE and never appears as latest.',
        'A future signed release candidate uses the separate vX.Y.Z-rc.N lane and is rebuilt from the same source line with production platform signing. Preview bytes are never renamed, replaced, or promoted into RC or Stable.',
      ],
    },
    sourceBuild: {
      title: 'Source builds are different from releases',
      paragraphs: [
        'Local development builds may use a self-signed certificate for same-machine testing. That certificate is never a production identity and is never included in the GitHub unsigned-preview assets.',
        'GitHub unsigned previews originate from the dedicated preview workflow, match one exact source commit, and remain visibly separate from the protected signed-RC and Stable paths.',
      ],
    },
    verification: {
      title: 'Release assets and verification',
      paragraphs: [
        'The current Windows developer preview contains the portable Runtime ZIP and the separate Kit tarball, but no release-owned checksums file. Together with the macOS candidate, they are identified by their unsigned-preview marker and scoped platform acceptance; this preview does not claim a release checksum set or complete SBOM.',
        'The exact Nimi-Runtime-v0.2.2-preview.1-windows-x64-unsigned-bootstrap.zip contains the real Windows x64 Runtime executable, its Apache-2.0 license, and explicit unsigned-bootstrap instructions.',
        'Because it is unsigned, Windows SmartScreen, Smart App Control, or an organization policy may warn or block it. Do not disable Windows security controls to run this preview.',
        'The Windows package carries its complete MIT LICENSE. The macOS archive carries complete MIT and Apache-2.0 texts under LICENSES for its App/Kit/Avatar and Runtime material.',
        'For Windows preview PE files, Authenticode must report NotSigned. For the macOS preview, codesign must report Signature=adhoc and TeamIdentifier=not set. Either result proves only preview identity, never production trust.',
      ],
      items: [
        'Release: use only the official GitHub Releases page or this Download page.',
        'Checksums: the current developer preview makes no checksum claim; future signed RC and Stable assets must use their release-owned checksums.',
        'SBOM: required for a future signed RC and Stable; the current preview does not claim complete SBOM coverage.',
        'Signature: follow the Code signing policy; preview signatures are intentionally absent or ad-hoc and cannot establish production trust.',
      ],
    },
    providerTitle: 'Windows code signing',
    providerLabel: 'Planned code-signing provider (application not submitted)',
    attribution: 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    disclaimer:
      'No current Nimi artifact should be treated as SignPath-signed unless its Authenticode signature verifies successfully.',
    systemChanges: {
      title: 'Developer preview and Windows system changes',
      paragraphs: [
        'Installing the Windows source-local npm tarball does not create a Windows service, install a certificate, modify PATH, or write below Program Files. The same preview contains a separate portable Runtime ZIP, but no Nimi Home app, installer, or service package.',
        'The v0.2.2-preview.1 portable Runtime bootstrap is not an installer or service. Use it by extracting the ZIP and running .\\nimi.exe version --json; remove it by closing the process and deleting the extracted directory. It does not modify PATH, Program Files, ProgramData, or Windows certificate stores, and protected-local production remains unavailable.',
        'The macOS candidate is repo-assisted. From the exact source checkout, install with node scripts/accept-runtime-fixed-service.mjs --install-candidate <absolute-candidate-path>. This creates the _nimiruntimedev user and group, the ai.nimi.runtime.dev LaunchDaemon, /Applications/Nimi Dev.app, /Library/Application Support/Nimi/RuntimeDev, /usr/local/libexec/nimi-macos-dev-security, local Runtime socket paths, and the root-owned /private/var/run/nimi-macos-dev-security.lock operation lock.',
        'There is no admitted production Windows installer. The current development-only service installer writes versioned Runtime files below %ProgramFiles%\\Nimi\\Runtime\\versions and protected Runtime state below %ProgramData%\\Nimi\\Runtime\\Protected. It creates the automatic LocalSystem service NimiRuntime and does not modify PATH.',
        'During install or update, the development prototype stops the existing service, takes custody of protected state and applies its service ACLs, then runs the bundled repair-local-agent-chat.exe against %ProgramData%\\Nimi\\Runtime\\Protected\\runtime\\memory.db. Repair can create a verified same-directory backup and sidecar files. The service uses a restricted service SID and bounded failure recovery: restart after 1, 3, and 10 seconds, then stop.',
        'That development installer imports a local self-signed certificate into LocalMachine Root and TrustedPublisher and has no complete product uninstall path. These facts block it from public production distribution. A future production installer must not install a development certificate or alter Root/TrustedPublisher trust stores for Nimi self-signing.',
        'Runtime-managed models, dependencies, environments, app and account data, app/account-scoped cache data, and the configured logs and audit roots live under the user-selected nimi_data root, separate from the service files. The current directory configuration defines no independent shared cache root.',
        'The protected Runtime currently logs to standard output and, on a best-effort basis, Windows Event Log. The development installer does not configure a persistent log file, so the configured nimi_data logs root must not be described as a proven service log destination.',
      ],
    },
    uninstall: {
      title: 'Uninstallation and cleanup',
      paragraphs: [
        'For the Windows developer preview, uninstall the source-local package with npm uninstall. The preview acceptance job installs, requires, uninstalls, and confirms the package path is absent afterward.',
        'The v0.2.2-preview.1 Windows Runtime bootstrap has no installer or uninstall program. Close any running nimi.exe process and delete the extracted directory; no service or protected product state is created by the documented version command.',
        'For the repo-assisted macOS candidate, run node scripts/accept-runtime-fixed-service.mjs --uninstall from the exact source checkout. The lifecycle check confirms the development service, App, helper, sockets, and _nimiruntimedev principal are removed. The empty root-owned operation-lock file may remain until reboot and contains no product data.',
        'Because no production installer is admitted, there is no public production uninstall flow today. A complete tested uninstall remains a release blocker.',
        'For the development prototype only, an administrator must stop NimiRuntime, delete the service, remove %ProgramFiles%\\Nimi\\Runtime, and then choose whether to preserve or remove %ProgramData%\\Nimi\\Runtime\\Protected, including memory.db and any repair backup or sidecar files. Any local-development certificate installed by that prototype must also be removed from the LocalMachine Root and TrustedPublisher stores by its exact thumbprint.',
        'The user-selected nimi_data root is preserved by default. Delete its models, dependencies, environments, apps, accounts, app/account-scoped cache data, or configured logs/audit roots only after reviewing and backing up what you need. No independent shared cache root is defined. Deletion is irreversible.',
      ],
    },
    linksTitle: 'Official links',
  },
  policy: {
    meta: {
      title: 'Code signing policy | Nimi',
      description:
        'Nimi code signing policy: current Windows status, planned SignPath attribution, signed artifact scope, release controls, and verification instructions.',
      canonical: 'https://nimi.ai/code-signing',
    },
    kicker: 'Trust and release integrity',
    title: 'Code signing policy',
    intro:
      'This public policy defines the production-signing boundary for Windows artifacts built from the Nimi open-source repository. It distinguishes planned controls from the current, not-yet-approved release state.',
    statusTitle: 'SignPath Foundation application not submitted',
    statusBody:
      'There is no production-signed Windows release and no current Nimi artifact may be represented as SignPath-signed.',
    status: {
      title: 'Status',
      paragraphs: [
        'The required public unsigned Runtime bootstrap was published as immutable prerelease v0.2.2-preview.1. The SignPath Foundation application has not yet been submitted; Nimi has not been approved and SignPath has not provided production code signing or a project certificate.',
        'No production-signed Windows release has been published. Local self-signing remains limited to same-machine development. Public unsigned previews are separately labeled GitHub prereleases and never claim production identity.',
        'Signed RC and Stable publication remain blocked while no production Authenticode signer is connected. That signer is not a prerequisite for an explicit unsigned bootstrap preview, which remains non-promotable and does not enable protected-local production.',
        'Until approval and production workflow integration are complete, Nimi will not imply that SignPath or SignPath Foundation has signed any artifact.',
      ],
    },
    attributionTitle: 'Planned attribution',
    attributionIntro:
      'If the application is approved and the production signing workflow is enabled, Nimi plans to use the following attribution:',
    attribution: 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    attributionPending:
      'This is a planned attribution only. The bootstrap prerequisite is published, but the SignPath Foundation application has not yet been submitted.',
    scope: {
      title: 'Scope of signed artifacts',
      paragraphs: [
        'The initial SignPath application scope is one Nimi-owned Windows x64 Runtime executable named nimi.exe. The published v0.2.2-preview.1 unsigned bootstrap provides that executable and portable ZIP topology before the application; it remains unsigned and non-promotable.',
        'The Kit protected-local Node addon is not in the initial signing scope, and Authenticode on that .node file is not a Phase 4A release gate. After approval, the package consumes the signed Runtime leaf certificate\'s SubjectPublicKeyInfo (SPKI) SHA-256 solely for Runtime peer verification. Nimi signs only its own reviewed public-source binaries and never signs a third-party App or upstream binary.',
      ],
      items: [
        'Initial application scope: the Nimi-owned Windows x64 Runtime nimi.exe.',
        'Kit protected-local .node: Authenticode is not required for Phase 4A and it is not part of the initial signing request.',
        'Third-party Apps, upstream binaries, installers, service helpers, and repair helpers: excluded from the initial scope.',
      ],
    },
    upstream: {
      title: 'Third-party and upstream binaries',
      paragraphs: [
        'Nimi does not use its signing identity to sign third-party Apps or upstream binaries. A future signed release discloses included components through its SBOM and license materials; the unsigned preview makes no complete SBOM claim.',
      ],
    },
    build: {
      title: 'Build origin and release process',
      paragraphs: [
        'The source repository is https://github.com/nimiplatform/nimi. GitHub Actions is the only production build system. Production signing does not accept arbitrary binaries uploaded from a developer workstation.',
        'A release PR freezes package versions and the CHANGELOG. The independent unsigned-preview workflow uses an immutable vX.Y.Z-preview.N tag and is never a promotion input. A future signed RC uses vX.Y.Z-rc.N and must rebuild platform-signed bytes from the same source line before Stable may reuse those signed RC assets.',
        'The first bootstrap step is complete: v0.2.2-preview.1 publishes the reviewed unsigned Windows x64 Runtime preview. Next, apply to SignPath Foundation; after approval, use the project certificate to build and sign the formal Runtime; verify the signed result and derive the leaf certificate SubjectPublicKeyInfo (SPKI) SHA-256; only then publish the production protected-local package. The unsigned bytes are never retroactively signed or promoted.',
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
        'The protected signing environment and its manual approval rule are not configured today. That missing enforcement is a production Windows release blocker.',
      ],
    },
    metadata: {
      title: 'Artifact identity and metadata',
      paragraphs: [
        'The intended production configuration uses a consistent Nimi Product Name and the same Product Version across all signed files in one release, SHA-256 Authenticode, and an RFC 3161 timestamp.',
        'Before a production Windows release is admitted, the workflow must publish SHA-256 checksums and an SBOM, re-verify every signature after signing, and only then package ZIP, npm, or GitHub Release assets. A signer-identity, file-content, version, or checksum mismatch must block release.',
      ],
    },
    metadataBlocker:
      'Signed RC and Stable blockers: SignPath approval, production signing, post-signature verification, and repackaging are not integrated. The v0.2.2-preview.1 workflow verified exact Windows PE Product Name, Product Version, architecture, and NotSigned posture for the unsigned bootstrap; that is unsigned-preview evidence, not production-signing evidence. Nimi will not claim production signing controls are active before every signed-release gate is implemented and verified.',
    verificationTitle: 'Verification instructions',
    verificationIntro:
      'Verify a downloaded Windows file before running it. An explicit vX.Y.Z-preview.N PE is expected to report NotSigned and is never production trusted. For a future production-signed release, require every check below. PowerShell is available on Windows; signtool is provided by the Windows SDK.',
    verificationChecks: [
      'Production release Status is Valid.',
      'Publisher is SignPath Foundation only after approval and formal production enablement.',
      'The file version matches the release version.',
      'The file came from the official GitHub Release or the nimi.ai Download page.',
      'The SHA-256 checksum matches the checksums file attached to that same release.',
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
        'The published v0.2.2-preview.1 unsigned Runtime bootstrap is portable, not an installer. Extracting it and running .\\nimi.exe version --json creates no NimiRuntime service and does not modify PATH, Program Files, ProgramData, or Windows certificate stores. It does not enable protected-local production.',
        'No production Windows installer is currently admitted or downloadable. The development-only prototype writes Runtime versions below %ProgramFiles%\\Nimi\\Runtime\\versions, protected configuration and service state below %ProgramData%\\Nimi\\Runtime\\Protected, and creates the automatic LocalSystem service NimiRuntime. It does not modify PATH.',
        'Install and update stop the existing service, take custody of protected state and apply service ACLs, then run the bundled repair-local-agent-chat.exe against %ProgramData%\\Nimi\\Runtime\\Protected\\runtime\\memory.db. Repair can leave a verified same-directory backup and sidecars. NimiRuntime uses a restricted service SID and bounded failure recovery: restart after 1, 3, and 10 seconds, then stop.',
        'The prototype imports its development self-signed certificate into LocalMachine Root and TrustedPublisher so LocalSystem can validate local test binaries. That behavior is prohibited for a production installer and is one reason the prototype is not a release artifact.',
        'Models, dependencies, environments, app/account data, app/account-scoped cache data, and configured logs/audit roots are stored under the user-selected nimi_data root. No independent shared cache root is defined. Their removal is separate from removing installed program files.',
        'The protected Runtime currently emits ordinary logs to standard output and may write failures to Windows Event Log on a best-effort basis. The installer does not configure a persistent log file; the configured nimi_data logs root is not claimed here as an observed service log destination.',
      ],
    },
    uninstall: {
      title: 'Uninstallation',
      paragraphs: [
        'The published v0.2.2-preview.1 portable bootstrap has no installer or uninstaller. Close any running nimi.exe process and delete the extracted directory; its documented version command creates no service or protected product state.',
        'There is no admitted production uninstall flow. A production Windows installer cannot be released until stopping and removing NimiRuntime, removing installed program files, and preserving or explicitly cleaning user data are covered by a real tested uninstall path.',
        'Development-prototype cleanup requires an elevated PowerShell session: stop NimiRuntime, delete the NimiRuntime service, remove %ProgramFiles%\\Nimi\\Runtime, and then explicitly preserve or remove %ProgramData%\\Nimi\\Runtime\\Protected, including memory.db and any repair backup or sidecar files. Remove the local-development certificate from LocalMachine Root and TrustedPublisher by its exact thumbprint if the prototype installed it.',
        'The user-selected nimi_data root is preserved. Its models, dependencies, environments, apps, accounts, app/account-scoped cache data, and configured logs/audit roots may be deleted separately only with explicit user intent. No independent shared cache root is defined. Back up wanted data first; deletion is irreversible.',
      ],
    },
    historical: {
      title: 'Historical unsigned releases',
      paragraphs: [
        'Explicit pre-approval unsigned previews may be distributed through vX.Y.Z-preview.N GitHub prereleases. They are never described retroactively as signed and never become RC or Stable assets.',
        'Signature status is determined per file through Authenticode verification, not by project version, filename, or publication date.',
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
        'Documentation and specification content uses its own content license and is not represented as the binary software license. Third-party components and their licenses remain separately disclosed through the SBOM and license materials.',
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
    reviewed: '仓库状态复核于 2026 年 9 月 4 日',
    securityAdvisoryDetail: '私下提交漏洞',
    securityEmailDetail: '私下安全联系',
  },
  download: {
    meta: {
      title: '下载 Nimi | 发布状态',
      description: 'Nimi 开源、本地优先个人 AI 产品的稳定版状态与 unsigned preview 验证说明。',
      canonical: 'https://nimi.ai/download',
    },
    kicker: '发布状态',
    title: '下载 Nimi',
    intro:
      'Nimi 是可安装、开源、本地优先的个人 AI 产品。Nimi Home 是产品入口，Realm 负责生态身份，Runtime 执行本地或云端的多提供商 AI 能力。本页明确区分稳定版与 unsigned preview。',
    statusTitle: '稳定版：尚未提供',
    statusBody:
      'GitHub 上还没有 Nimi 稳定版 Release。不可变 prerelease v0.2.2-preview.1 已提供明确标注为 unsigned 的 portable Windows x64 Runtime bootstrap；它不可晋升，也不进入 stable latest。Production 平台签名可用前，signed RC 与 Stable 继续 fail closed。',
    releaseAction: '下载 unsigned Windows Runtime v0.2.2-preview.1',
    release: {
      title: '稳定版状态',
      paragraphs: [
        'Nimi Home 把对话、角色、创作、故事、世界、设置与 Nimi Apps 连接在同一个个人 AI 产品中。Runtime 执行用户选择的本地或云端 AI 能力，Realm 负责账号与生态身份。',
        '普通 latest 路径只表示稳定版，不会把 RC 当作最新稳定版。',
        '目前没有任何平台提供正式稳定版下载。不可变的 v0.2.2-preview.1 unsigned developer preview 已可从 GitHub Releases 下载；它只包含下方列出的制品，不是独立产品 installer。',
      ],
    },
    platformTitle: '平台可用性',
    platforms: [
      {
        name: 'Windows',
        status: 'Unsigned Runtime bootstrap 已发布',
        detail: '不可变 prerelease v0.2.2-preview.1 包含 portable unsigned Windows x64 Runtime bootstrap，以及独立的 source-local Kit native 包；它不包含 Nimi Home App、installer、Windows service package 或 protected-local production release。',
      },
      {
        name: 'macOS',
        status: '需仓库协助的 unsigned candidate',
        detail: 'Ad-hoc candidate 没有 Apple TeamIdentifier、Developer ID 签名或 notarization。安装和卸载要求使用 candidate commit 的准确源码 checkout；CI 验收这条 repo-assisted lifecycle，因此它不是 standalone installer、RC 或稳定版。',
      },
      {
        name: 'Linux',
        status: '无 preview 制品',
        detail: 'Unsigned developer preview 不发布 Linux Runtime archive 或 Nimi App；当前也没有正式稳定版 Linux Release。',
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
        'Unsigned preview 只能通过不可变的 vX.Y.Z-preview.N tag 与 GitHub prerelease 页面访问，并明确标记 UNSIGNED PREVIEW — NOT PROMOTABLE，不进入 latest。',
        '未来 signed RC 使用独立的 vX.Y.Z-rc.N 路径，从同一源码主线重新构建 production-signed bytes；preview bytes 绝不改名、替换或晋升为 RC/Stable。',
      ],
    },
    sourceBuild: {
      title: '源码构建不同于正式发布',
      paragraphs: [
        '本地开发构建可能使用自签证书做同一台机器上的测试。它不是 production identity，也不会被放进 GitHub unsigned-preview assets。',
        'GitHub unsigned preview 来自独立 preview workflow，绑定一个准确 source commit，并与受保护的 signed-RC/Stable 路径持续分离。',
      ],
    },
    verification: {
      title: 'Release 制品与验证',
      paragraphs: [
        '当前 Windows developer preview 包含 portable Runtime ZIP 和独立 Kit tarball，但没有 release-owned checksums 文件。它们与 macOS candidate 都由 unsigned-preview marker 和范围内的平台验收识别；该 preview 不声称具有 release checksum 集合或完整 SBOM。',
        '准确的 Nimi-Runtime-v0.2.2-preview.1-windows-x64-unsigned-bootstrap.zip 包含真实 Windows x64 Runtime executable、Apache-2.0 license 与明确的 unsigned-bootstrap 说明。',
        '由于该制品未签名，Windows SmartScreen、Smart App Control 或组织策略可能给出警告或直接阻止执行。不要为了运行此 preview 而关闭 Windows 安全能力。',
        'Windows package 携带完整 MIT LICENSE；macOS archive 在 LICENSES 下携带完整 MIT 与 Apache-2.0 文本，分别覆盖 App/Kit/Avatar 与 Runtime material。',
        'Windows preview PE 的 Authenticode 应显示 NotSigned；macOS preview 的 codesign 应显示 Signature=adhoc 且 TeamIdentifier=not set。这些结果只能证明 preview 身份，不能建立 production trust。',
      ],
      items: [
        'Release：只使用 GitHub Releases 官方页面或本 Download 页面。',
        'Checksums：当前 developer preview 不作 checksum 声明；未来 signed RC 与 Stable 必须使用各自 release 所属的 checksums。',
        'SBOM：未来 signed RC 与 Stable 必须提供；当前 preview 不声称完整 SBOM 覆盖。',
        'Signature：按 Code signing policy 验证；preview 刻意保持 unsigned 或 ad-hoc，不能建立 production trust。',
      ],
    },
    providerTitle: 'Windows 代码签名',
    providerLabel: 'Planned code-signing provider (application not submitted)',
    attribution: 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    disclaimer: 'No current Nimi artifact should be treated as SignPath-signed unless its Authenticode signature verifies successfully.',
    systemChanges: {
      title: 'Developer preview 与 Windows 系统改动',
      paragraphs: [
        '安装 Windows source-local npm tarball 不会创建 Windows service、安装证书、修改 PATH 或写入 Program Files。同一个 preview 还包含独立的 portable Runtime ZIP，但不包含 Nimi Home App、installer 或 service package。',
        'v0.2.2-preview.1 portable Runtime bootstrap 不是 installer 或 service。解压 ZIP 并运行 .\\nimi.exe version --json 即可使用；关闭进程并删除解压目录即可移除。它不会修改 PATH、Program Files、ProgramData 或 Windows certificate stores，也不会使 protected-local production 可用。',
        'macOS candidate 需要仓库协助。从准确源码 checkout 执行 node scripts/accept-runtime-fixed-service.mjs --install-candidate <absolute-candidate-path>。安装会创建 _nimiruntimedev 用户和组、ai.nimi.runtime.dev LaunchDaemon、/Applications/Nimi Dev.app、/Library/Application Support/Nimi/RuntimeDev、/usr/local/libexec/nimi-macos-dev-security、本地 Runtime socket 路径，以及 root-owned /private/var/run/nimi-macos-dev-security.lock operation lock。',
        '目前没有准入的 production Windows installer。现有仅供开发的 service installer 把 Runtime 版本写入 %ProgramFiles%\\Nimi\\Runtime\\versions，把受保护状态写入 %ProgramData%\\Nimi\\Runtime\\Protected；它创建 LocalSystem 自动服务 NimiRuntime，但不修改 PATH。',
        '安装或更新时，开发原型会停止现有 service，接管 protected state 并设置 service ACL，然后用随包提供的 repair-local-agent-chat.exe 对 %ProgramData%\\Nimi\\Runtime\\Protected\\runtime\\memory.db 做 offline repair；repair 可能留下同目录、经过验证的备份与 sidecar 文件。NimiRuntime 使用 restricted service SID，故障恢复按 1 秒、3 秒、10 秒重启，随后停止。',
        '该开发 installer 会把本地自签证书导入 LocalMachine Root 和 TrustedPublisher，而且没有完整的产品卸载路径，因此禁止公开生产分发。未来 production installer 不得为 Nimi 自签名改写 Root 或 TrustedPublisher 信任库。',
        'Runtime 管理的模型、依赖、环境、App/账号数据、App/账号范围内的缓存数据，以及配置中的 logs/audit 根目录位于用户选择的 nimi_data 下，与 service 文件分开。当前目录配置没有独立的 shared cache 根目录。',
        'Protected Runtime 当前把普通日志写到标准输出，并尽力把失败写入 Windows Event Log。开发 installer 没有配置持久化日志文件，因此不能把配置中的 nimi_data logs 根目录描述为已经观察到的 service 日志目标。',
      ],
    },
    uninstall: {
      title: '卸载与清理',
      paragraphs: [
        'Windows developer preview 使用 npm uninstall 卸载 source-local 包；preview acceptance job 会真实安装、require、卸载并确认包路径已不存在。',
        'v0.2.2-preview.1 Windows Runtime bootstrap 没有 installer 或 uninstall program。关闭所有运行中的 nimi.exe process，再删除解压目录即可；文档所列的 version command 不会创建 service 或 protected product state。',
        'Repo-assisted macOS candidate 需要从准确源码 checkout 执行 node scripts/accept-runtime-fixed-service.mjs --uninstall；生命周期检查会确认 development service、App、helper、sockets 与 _nimiruntimedev principal 均已移除。空的 root-owned operation-lock 文件可能保留到重启，且不包含产品数据。',
        '目前没有准入的 production installer，因此也没有面向公众的 production uninstall。完成并真实测试卸载流程仍是 release blocker。',
        '仅针对开发原型，管理员需要停止 NimiRuntime、删除该 service、删除 %ProgramFiles%\\Nimi\\Runtime，再明确选择保留或删除 %ProgramData%\\Nimi\\Runtime\\Protected，其中包括 memory.db 及 repair backup/sidecar 文件；若原型安装过本地开发证书，还要按准确 thumbprint 从 LocalMachine Root 和 TrustedPublisher 删除。',
        '用户选择的 nimi_data 默认保留。只有在检查并备份所需内容后，才应单独删除其中的模型、依赖、环境、Apps、账号、App/账号范围内的缓存数据或配置中的 logs/audit 根目录；当前没有独立的 shared cache 根目录。删除不可恢复。',
      ],
    },
    linksTitle: '官方入口',
  },
  policy: {
    meta: {
      title: 'Code signing policy | Nimi',
      description: 'Nimi Windows 代码签名政策：当前状态、计划中的 SignPath 归属、签名范围、发布控制与验证方法。',
      canonical: 'https://nimi.ai/code-signing',
    },
    kicker: '信任与发布完整性',
    title: 'Code signing policy',
    intro: '本政策定义由 Nimi 开源仓库构建的 Windows 制品之 production-signing 边界，并把计划中的控制与尚未获批的当前状态明确区分。',
    statusTitle: 'SignPath Foundation 申请尚未提交',
    statusBody: '目前没有 production-signed Windows release，也没有任何 Nimi 制品可以被描述为 SignPath-signed。',
    status: {
      title: 'Status',
      paragraphs: [
        '所需的公开 unsigned Runtime bootstrap 已通过不可变 prerelease v0.2.2-preview.1 发布。SignPath Foundation 申请尚未提交；Nimi 尚未获批，SignPath 也尚未为项目提供 production code signing 或项目证书。',
        '当前没有已发布的 production-signed Windows release。本地自签只用于同机开发；公开 unsigned preview 使用独立标记的 GitHub prerelease，绝不声称 production identity。',
        '未接入 production Authenticode signer 时，signed RC 与 Stable publication 必须保持阻断。显式 unsigned bootstrap preview 不以该 signer 为前置，但它不可晋级，也不会使 protected-local production 可用。',
        '在获批并接通 production workflow 前，Nimi 不会暗示任何制品已由 SignPath 或 SignPath Foundation 签名。',
      ],
    },
    attributionTitle: 'Planned attribution',
    attributionIntro: '如果申请获批并正式启用 production signing workflow，Nimi 计划使用以下归属语句：',
    attribution: 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    attributionPending: '这只是获批后的计划归属；bootstrap 前置已发布，但 SignPath Foundation 申请尚未提交。',
    scope: {
      title: 'Scope of signed artifacts',
      paragraphs: [
        '初次 SignPath 申请范围只有一个 Nimi 自有的 Windows x64 Runtime executable：nimi.exe。已发布的 v0.2.2-preview.1 unsigned bootstrap 在申请前提供了该 executable 与 portable ZIP 拓扑；它仍然是 unsigned 且不可晋升。',
        'Kit protected-local Node addon 不在初次签名范围内，.node 文件上的 Authenticode 也不是 Phase 4A release gate。获批后，该 package 只为 Runtime peer verification 使用已签名 Runtime leaf certificate 的 SubjectPublicKeyInfo（SPKI）SHA-256。Nimi 只签经过 review 的自有公开源码二进制，绝不为第三方 App 或 upstream binary 签名。',
      ],
      items: [
        '初次申请范围：Nimi 自有 Windows x64 Runtime nimi.exe。',
        'Kit protected-local .node：Phase 4A 不要求 Authenticode，也不进入初次签名申请。',
        '第三方 Apps、upstream binaries、installers、service helpers 与 repair helpers：不在初次范围内。',
      ],
    },
    upstream: {
      title: '第三方与上游二进制',
      paragraphs: ['Nimi 不用自己的签名身份为第三方 Apps 或 upstream binaries 签名。未来 signed release 通过 SBOM 与许可证材料披露所含组件；unsigned preview 不声称完整 SBOM 覆盖。'],
    },
    build: {
      title: 'Build origin and release process',
      paragraphs: [
        '源代码仓库是 https://github.com/nimiplatform/nimi。GitHub Actions 是唯一 production build system，production signing 不接受开发者工作站任意上传的二进制。',
        'Release PR 冻结 package versions 与 CHANGELOG；独立 unsigned-preview workflow 使用不可变 vX.Y.Z-preview.N tag，永远不是晋升输入。未来 signed RC 使用 vX.Y.Z-rc.N，并从同一源码主线重新构建平台签名 bytes；Stable 只能复用通过 RC gates 的 signed assets。',
        'Bootstrap 第一步已经完成：v0.2.2-preview.1 发布了经过 review 的 unsigned Windows x64 Runtime preview。下一步才是申请 SignPath Foundation；获批后使用项目证书构建并签署正式 Runtime，验证签名结果并计算 leaf certificate 的 SubjectPublicKeyInfo（SPKI）SHA-256，最后才发布 production protected-local package。Unsigned bytes 不会被追溯签名或晋级。',
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
        '受保护 signing environment 及其人工批准规则当前尚未配置；缺少这项强制控制会阻止 production Windows release。',
      ],
    },
    metadata: {
      title: 'Artifact identity and metadata',
      paragraphs: [
        '计划中的 production 配置要求所有签名文件使用一致的 Nimi Product Name，同一 release 的 Product Version 保持一致，采用 SHA-256 Authenticode 与 RFC 3161 timestamp。',
        'Production Windows release 获准前，workflow 必须发布 SHA-256 checksums 与 SBOM，在签名后重新验证每一项 signature，再封装 ZIP、npm 或 GitHub Release assets；signer identity、文件内容、版本或 checksum 任一不一致都必须阻止发布。',
      ],
    },
    metadataBlocker: 'Signed RC 与 Stable blockers：SignPath 批准、production signing、签名后验证及重新封装尚未接入。v0.2.2-preview.1 workflow 已为 unsigned bootstrap 验证准确的 Windows PE Product Name、Product Version、架构与 NotSigned 姿态；这是 unsigned-preview evidence，不是 production-signing evidence。全部 signed-release gates 实现并验证前，Nimi 不会声称 production signing controls 已生效。',
    verificationTitle: 'Verification instructions',
    verificationIntro: '运行下载的 Windows 文件前先验证。显式 vX.Y.Z-preview.N PE 预期显示 NotSigned，绝不具备 production trust；未来 production-signed release 必须满足下列全部条件。PowerShell 随 Windows 提供，signtool 来自 Windows SDK。',
    verificationChecks: [
      'Production release 的 Status 为 Valid。',
      '只有在获批并正式启用后，Publisher 才应为 SignPath Foundation。',
      '文件版本与 release 版本一致。',
      '文件来自 GitHub Release 官方页面或 nimi.ai Download 页面。',
      'SHA-256 checksum 与同一 release 的 checksums 文件一致。',
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
        '已发布的 v0.2.2-preview.1 unsigned Runtime bootstrap 是 portable archive，不是 installer。解压并运行 .\\nimi.exe version --json 不会创建 NimiRuntime service，也不会修改 PATH、Program Files、ProgramData 或 Windows certificate stores；它不会使 protected-local production 可用。',
        '目前没有准入或可下载的 production Windows installer。开发原型把 Runtime versions 写入 %ProgramFiles%\\Nimi\\Runtime\\versions，把 protected configuration 与 service state 写入 %ProgramData%\\Nimi\\Runtime\\Protected，并创建 LocalSystem 自动服务 NimiRuntime；它不修改 PATH。',
        '安装与更新会停止现有 service，接管 protected state 并设置 service ACL，再用随包提供的 repair-local-agent-chat.exe 对 %ProgramData%\\Nimi\\Runtime\\Protected\\runtime\\memory.db 做 offline repair；repair 可能留下同目录、经过验证的 backup 与 sidecars。NimiRuntime 使用 restricted service SID，故障恢复按 1 秒、3 秒、10 秒重启，随后停止。',
        '原型会把开发自签证书导入 LocalMachine Root 与 TrustedPublisher，让 LocalSystem 校验本地测试二进制。Production installer 禁止这样做，这也是原型不能成为 release artifact 的原因之一。',
        '模型、依赖、环境、App/账号数据、App/账号范围内的缓存数据，以及配置中的 logs/audit 根目录位于用户选择的 nimi_data 下；当前没有独立的 shared cache 根目录。删除这些内容与删除 program files 是两件独立操作。',
        'Protected Runtime 当前把普通日志写到标准输出，并尽力把失败写入 Windows Event Log。Installer 不配置持久化日志文件，因此本政策不把配置中的 nimi_data logs 根目录描述为已观察到的 service 日志目标。',
      ],
    },
    uninstall: {
      title: 'Uninstallation',
      paragraphs: [
        '已发布的 v0.2.2-preview.1 portable bootstrap 没有 installer 或 uninstaller。关闭所有运行中的 nimi.exe process 并删除解压目录即可；文档所列的 version command 不会创建 service 或 protected product state。',
        '当前没有准入的 production uninstall flow。在真实流程覆盖停止并删除 NimiRuntime、删除安装文件、默认保留或由用户明确清理数据之前，production Windows installer 不能发布。',
        '清理开发原型需要 elevated PowerShell：停止 NimiRuntime、删除 NimiRuntime service、删除 %ProgramFiles%\\Nimi\\Runtime，再明确选择保留或删除 %ProgramData%\\Nimi\\Runtime\\Protected，其中包括 memory.db 及 repair backup/sidecar 文件；若原型安装过本地开发证书，还要按准确 thumbprint 从 LocalMachine Root 与 TrustedPublisher 删除。',
        '用户选择的 nimi_data 默认保留。只有用户明确决定后，才单独删除其中的模型、依赖、环境、Apps、账号、App/账号范围内的缓存数据，以及配置中的 logs/audit 根目录；当前没有独立的 shared cache 根目录。先备份所需内容；删除不可恢复。',
      ],
    },
    historical: {
      title: 'Historical unsigned releases',
      paragraphs: [
        '获批前的 unsigned preview 可通过 vX.Y.Z-preview.N GitHub prerelease 显式分发；它们绝不会被追溯描述为已签名，也不会成为 RC 或 Stable assets。',
        '具体 artifact 的签名状态只能通过 Authenticode 验证判断，不能根据版本号、文件名或发布日期推断。',
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
        'Docs/spec 内容使用单独的内容许可证，不能被描述为二进制软件许可证。第三方组件及许可证继续通过 SBOM 与 license materials 独立披露。',
      ],
    },
  },
};

export const PUBLIC_PAGE_CONTENT: Readonly<Record<LandingLocale, PublicPageCopy>> = {
  en: EN_COPY,
  zh: ZH_COPY,
};

function browserStorage(): StorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function initialLocale(): LandingLocale {
  return resolveInitialLocale({
    storage: browserStorage(),
    search: typeof window === 'undefined' ? '' : window.location.search,
    navigatorLanguage: typeof navigator === 'undefined' ? '' : navigator.language,
    defaultLocale: import.meta.env.VITE_LANDING_DEFAULT_LOCALE,
  });
}

function usePublicPageLocale(): [LandingLocale, (locale: LandingLocale) => void] {
  const [locale, setLocale] = useState<LandingLocale>(initialLocale);
  return [locale, (nextLocale) => {
    setLocale(nextLocale);
    persistLocale(nextLocale, browserStorage());
  }];
}

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
    <div className="release-page-shell">
      <a href="#release-main" className="skip-link">{copy.skipToContent}</a>
      <header className="release-header">
        <div className="release-container release-header-inner">
          <Link to="/" className="release-brand">
            <img src="/logo.svg" alt="" width="32" height="32" />
            <span>Nimi</span>
          </Link>
          <nav aria-label="Nimi public pages">
            <Link to="/">{copy.backHome}</Link>
            <Link to="/download">{copy.download}</Link>
            <Link to="/code-signing">{copy.policy}</Link>
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
            <Link to="/privacy">{copy.privacy}</Link>
            <Link to="/terms">{copy.terms}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function DownloadPage() {
  const [locale, setLocale] = usePublicPageLocale();
  const page = PUBLIC_PAGE_CONTENT[locale].download;
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
      action={<a className="release-primary-action" href={UNSIGNED_BOOTSTRAP_ASSET_URL}>{page.releaseAction}</a>}
    >
      <PageSection title={page.release.title}>
        <TextSectionContent section={page.release} />
        <p><a href={UNSIGNED_BOOTSTRAP_RELEASE_URL}>GitHub Release v0.2.2-preview.1</a></p>
      </PageSection>

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

      <PageSection title={page.providerTitle}>
        <p className="release-label">{page.providerLabel}</p>
        <p><strong>{page.attribution}</strong></p>
        <p className="release-warning">{page.disclaimer}</p>
        <p><Link to="/code-signing">Code signing policy</Link></p>
      </PageSection>

      {[page.prerelease, page.sourceBuild, page.verification].map((section) => (
        <PageSection key={section.title} title={section.title}>
          <TextSectionContent section={section} />
        </PageSection>
      ))}

      <PageSection title={page.systemChanges.title}>
        <TextSectionContent section={page.systemChanges} />
      </PageSection>

      <PageSection title={page.uninstall.title}>
        <TextSectionContent section={page.uninstall} />
      </PageSection>

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
        <p><Link to="/privacy">https://nimi.ai/privacy</Link></p>
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

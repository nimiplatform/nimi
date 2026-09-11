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
    reviewed: 'Release status updated September 11, 2026',
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
      'Check what you can download today, which platforms it works on, and what to expect before you run it.',
    statusTitle: 'Stable release: Not yet available',
    statusBody:
      'The complete Nimi product includes Desktop, Runtime, and Avatar. There is no stable Nimi release or Nimi Home installer to download yet. Earlier mixed developer previews are being withdrawn while release identities are corrected. Source code remains available for development.',
    releaseAction: 'Browse source code',
    preview: {
      title: 'Developer preview downloads withdrawn',
      scope: 'The earlier releases grouped different components under a repository-wide version. They are being withdrawn and are not replaced by a new product or component release.',
      warning: 'A future preview will identify exactly what it contains and its signing status. Do not disable Windows security controls to run unsigned files.',
      usage: 'Developers can review and build the source. If you already installed a previous preview, its cleanup guidance remains below.',
      releaseLink: 'View GitHub Releases',
      detailsLink: 'Developer guidance and cleanup',
    },
    release: {
      title: 'Product and release details',
      paragraphs: [
        'Nimi is an open-source, local-first personal AI product comprising Desktop, Runtime, and Avatar. Nimi Home is its Desktop-hosted entry for conversations, characters, creations, stories, worlds, settings, and Nimi Apps. Runtime executes local or cloud AI capabilities; Avatar provides the desktop embodiment. Realm owns account and ecosystem identity.',
        'The ordinary latest path is stable-only. It never treats a release candidate as the latest stable release.',
        'The complete product uses nimi/v<version> releases. Desktop-only and Runtime-only deliveries use desktop/v<version> and runtime/v<version>; libraries retain their own package versions. Zhiyu and Nimi Lab are independently published Third-party Apps, not components of the Nimi installation.',
        'Nimi Apps have three separate lifecycle paths: Registry-approved packages, explicit immutable local-package import, and Developer Mode. The current pilot uses protected Git tags, GitHub Actions and Releases, followed by human admission to a static Registry. Windows x86_64 supports Registry discovery, installation, launch, focus, stop, Access management, and uninstall; local development is also supported. The local-package import entry, other platforms’ package lifecycle, update, and repair remain unavailable. Installing an App does not grant Nimi access; account and Runtime conditions still apply.',
      ],
    },
    platformTitle: 'Platform availability',
    platforms: [
      {
        name: 'Windows',
        status: 'No current product or preview download',
        detail:
          'The former unsigned Runtime bootstrap and source-local Kit package are being withdrawn. Neither was a complete Desktop + Runtime + Avatar product. A replacement has not been published.',
      },
      {
        name: 'macOS',
        status: 'No current product or preview download',
        detail:
          'The former repo-assisted macOS candidate is being withdrawn with the mixed preview release. Local development builds remain available from source; there is no standalone installer, signed RC, or stable release to download.',
      },
      {
        name: 'Linux',
        status: 'No preview asset',
        detail: 'There is no official Nimi product or developer-preview download for Linux.',
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
        'Every pre-release identifies its owner: nimi/vX.Y.Z-preview.N for a complete Desktop + Runtime + Avatar product, desktop/vX.Y.Z-preview.N for Desktop, or runtime/vX.Y.Z-preview.N for Runtime. Libraries use their own component prefix and version. A bare vX.Y.Z-preview.N is not a repository-wide product version.',
        'Unsigned artifacts remain explicitly marked UNSIGNED PREVIEW — NOT PROMOTABLE and never appear as latest. Future signed RC tags retain the same owner prefix, such as runtime/vX.Y.Z-rc.N, and require new production-signed builds. Unsigned bytes are never renamed, replaced, or promoted into RC or Stable.',
      ],
    },
    sourceBuild: {
      title: 'Source builds are different from releases',
      paragraphs: [
        'Local development builds may use a self-signed certificate for same-machine testing. That certificate is never a production identity and is never included in the GitHub unsigned-preview assets.',
        'The former mixed-component preview publisher is retired. A local build does not create a public release; future publication must bind one declared product or component identity to its exact source commit and accepted artifacts.',
      ],
    },
    verification: {
      title: 'Release assets and verification',
      paragraphs: [
        'There is no replacement preview download to verify today. The former mixed preview did not claim a release checksum set or complete SBOM; withdrawal does not turn those files into production releases.',
        'A future release must identify its product or component, exact version, platforms, contents, and verification material. A complete Nimi download must include Desktop, Runtime, and Avatar; a component download must state its narrower scope.',
        'For previously downloaded Windows preview PE files, Authenticode reports NotSigned. The former macOS candidate uses an ad-hoc signature with no Apple TeamIdentifier. These states establish no production trust.',
      ],
      items: [
        'Source: use only the official GitHub repository and release pages.',
        'Identity: match the release owner, version, platform, and declared contents.',
        'Signed releases: require the release-owned checksums, SBOM, and signature verification described in the Code signing policy.',
      ],
    },
    providerTitle: 'Windows code signing',
    providerLabel: 'Planned code-signing provider (application not submitted)',
    attribution: 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    disclaimer:
      'No current Nimi artifact should be treated as SignPath-signed unless its Authenticode signature verifies successfully.',
    systemChanges: {
      title: 'Previously downloaded previews and development builds',
      paragraphs: [
        'The withdrawn Windows source-local Kit package was installed with npm. It did not install Nimi Home, a Windows service, or a certificate, or modify PATH or Program Files.',
        'If you downloaded the former portable Runtime bootstrap, its documented .\\nimi.exe version --json command does not install a service or modify PATH, Program Files, ProgramData, or certificate stores. It does not enable protected-local production.',
        'If you installed the former repo-assisted macOS candidate, its development namespace includes _nimiruntimedev, ai.nimi.runtime.dev, /Applications/Nimi Dev.app, /Library/Application Support/Nimi/RuntimeDev, /usr/local/libexec/nimi-macos-dev-security, local Runtime sockets, and the root-owned /private/var/run/nimi-macos-dev-security.lock operation lock. Use the cleanup instructions below.',
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
        'If you installed the withdrawn Windows source-local Kit package, remove it with npm uninstall in that project.',
        'The withdrawn portable Windows Runtime bootstrap has no uninstaller. Close any running nimi.exe process and delete the extracted directory; the documented version command creates no service or protected product state.',
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
        'The earlier mixed developer previews are being withdrawn while their release identities are corrected. A replacement public unsigned Runtime bootstrap has not been published. The SignPath Foundation application has not yet been submitted; Nimi has not been approved and SignPath has not provided production code signing or a project certificate.',
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
      'This attribution is planned for approval and production enablement. A replacement Runtime preview has not been published, and the SignPath Foundation application has not yet been submitted.',
    scope: {
      title: 'Scope of signed artifacts',
      paragraphs: [
        'The initial SignPath application scope is one Nimi-owned Windows x64 Runtime executable named nimi.exe. Any new public unsigned bootstrap must be published under its Runtime release identity, disclose its portable ZIP contents, and remain unsigned and non-promotable.',
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
        'A release PR freezes the named product or component version and CHANGELOG. Tags retain that owner prefix in every stage: nimi/vX.Y.Z for the complete Desktop + Runtime + Avatar product, desktop/vX.Y.Z for Desktop, runtime/vX.Y.Z for Runtime, or the governed library prefix. An unsigned preview is never a promotion input; a signed RC requires a new production-signed build.',
        'The next bootstrap publication must provide an independently identified Windows x64 Runtime preview. A SignPath Foundation application and approval remain separate owner actions. After approval, build and sign the formal Runtime, verify the signed result, and derive the leaf certificate SubjectPublicKeyInfo (SPKI) SHA-256 before publishing the production protected-local package. Unsigned bytes are never retroactively signed or promoted.',
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
      'SignPath approval, production signing, post-signature verification, and repackaging are not integrated. Future Runtime publication must verify PE Product Name, Product Version, architecture, and the declared signing posture. Nimi will not claim production signing controls are active before the signed-release path is implemented and verified.',
    verificationTitle: 'Verification instructions',
    verificationIntro:
      'Verify a downloaded Windows file before running it. An explicitly unsigned runtime/vX.Y.Z-preview.N executable is expected to report NotSigned and is never production trusted. For a future production-signed release, require every check below. PowerShell is available on Windows; signtool is provided by the Windows SDK.',
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
        'The withdrawn portable Runtime bootstrap did not include an installer or service. Its documented .\\nimi.exe version --json command creates no NimiRuntime service and does not modify PATH, Program Files, ProgramData, or Windows certificate stores. It does not enable protected-local production.',
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
        'If you downloaded the withdrawn portable Runtime bootstrap, close any running nimi.exe process and delete the extracted directory. It has no installer or uninstaller; its documented version command creates no service or protected product state.',
        'There is no admitted production uninstall flow. A production Windows installer cannot be released until stopping and removing NimiRuntime, removing installed program files, and preserving or explicitly cleaning user data are covered by a real tested uninstall path.',
        'Development-prototype cleanup requires an elevated PowerShell session: stop NimiRuntime, delete the NimiRuntime service, remove %ProgramFiles%\\Nimi\\Runtime, and then explicitly preserve or remove %ProgramData%\\Nimi\\Runtime\\Protected, including memory.db and any repair backup or sidecar files. Remove the local-development certificate from LocalMachine Root and TrustedPublisher by its exact thumbprint if the prototype installed it.',
        'The user-selected nimi_data root is preserved. Its models, dependencies, environments, apps, accounts, app/account-scoped cache data, and configured logs/audit roots may be deleted separately only with explicit user intent. No independent shared cache root is defined. Back up wanted data first; deletion is irreversible.',
      ],
    },
    historical: {
      title: 'Historical unsigned releases',
      paragraphs: [
        'The former repository-wide preview releases are being withdrawn. New previews must use their product or component namespace and state exactly what is delivered. Unsigned files are never described retroactively as signed and never become RC or Stable assets.',
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
    reviewed: '发布状态更新于 2026 年 9 月 11 日',
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
      '查看今天能下载什么、适用哪些平台，以及运行前需要了解的限制。',
    statusTitle: '稳定版：尚未提供',
    statusBody:
      '完整 Nimi 产品包含 Desktop、Runtime 和 Avatar。目前还没有可下载的 Nimi 稳定版或 Nimi Home 安装包。旧的混合开发者预览正在撤回，以纠正发布对象与版本归属；源代码仍可用于开发。',
    releaseAction: '查看源代码',
    preview: {
      title: '开发者预览下载已撤下',
      scope: '旧 Release 把不同组件放在同一个仓库整体版本下，目前正在撤回；尚未发布新的产品或组件版本来替代。',
      warning: '后续预览会明确交付对象、所含组件与签名状态。不要为了运行未签名文件而关闭 Windows 安全能力。',
      usage: '开发者可以查看源码并本地构建。如果已经安装旧预览，下方保留了清理说明。',
      releaseLink: '查看 GitHub Releases',
      detailsLink: '开发与清理说明',
    },
    release: {
      title: '产品与发布详情',
      paragraphs: [
        'Nimi 是由 Desktop、Runtime 和 Avatar 组成的开源、本地优先个人 AI 产品。Nimi Home 是由 Desktop 承载的入口，将对话、角色、创作、故事、世界、设置与 Nimi Apps 连接在一起。Runtime 执行本地或云端 AI 能力，Avatar 提供桌面形象，Realm 负责账号与生态身份。',
        '普通 latest 路径只表示稳定版，不会把 RC 当作最新稳定版。',
        '完整产品使用 nimi/v<版本> 发布；单独的 Desktop 和 Runtime 分别使用 desktop/v<版本>、runtime/v<版本>，各库保持自己的包版本。Zhiyu 和 Nimi Lab 是独立发布的第三方 App，不属于 Nimi 安装包。',
        'Nimi Apps 保留 Registry 已验证安装包、明确选择的不可变本地包导入和 Developer Mode 三条独立路径。当前试点通过受保护 Git tag、GitHub Actions 和 Releases 交付，再由人工准入静态 Registry。Windows x86_64 支持目录发现、安装、启动、聚焦、停止、Access 管理与卸载，也支持本地开发；本地包导入入口、其他平台的包生命周期、更新与修复仍不可用。安装 App 不等于授予 Nimi 访问能力，相关操作仍需满足账号与 Runtime 条件。',
      ],
    },
    platformTitle: '平台可用性',
    platforms: [
      {
        name: 'Windows',
        status: '暂无产品或预览下载',
        detail: '旧的未签名 Runtime 启动包与 source-local Kit 包正在撤回。它们都不是完整的 Desktop + Runtime + Avatar 产品，目前尚未发布替代版本。',
      },
      {
        name: 'macOS',
        status: '暂无产品或预览下载',
        detail: '旧的、需要仓库协助安装的 macOS 候选随混合预览一同撤回。仍可从源码进行本地开发；目前没有可下载的独立安装包、已签名 RC 或稳定版。',
      },
      {
        name: 'Linux',
        status: '无 preview 制品',
        detail: 'Linux 当前没有正式 Nimi 产品或开发者预览下载。',
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
        '预发布也必须标明归属：完整 Desktop + Runtime + Avatar 产品使用 nimi/vX.Y.Z-preview.N；Desktop 使用 desktop/vX.Y.Z-preview.N；Runtime 使用 runtime/vX.Y.Z-preview.N；各库使用自己的组件前缀与版本。裸 vX.Y.Z-preview.N 不代表仓库整体产品版本。',
        '未签名制品明确标记 UNSIGNED PREVIEW — NOT PROMOTABLE，不进入 latest。未来已签名 RC 保留同一归属前缀，例如 runtime/vX.Y.Z-rc.N，并重新构建生产签名制品；未签名文件不会通过改名、替换或晋升成为 RC 或 Stable。',
      ],
    },
    sourceBuild: {
      title: '源码构建不同于正式发布',
      paragraphs: [
        '本地开发构建可能使用自签证书做同一台机器上的测试。它不是 production identity，也不会被放进 GitHub unsigned-preview assets。',
        '旧的混合组件预览发布流程已停用。本地构建不会创建公开 Release；后续发布必须把明确的产品或组件身份与准确源码提交、验收通过的制品绑定。',
      ],
    },
    verification: {
      title: 'Release 制品与验证',
      paragraphs: [
        '目前没有新的预览下载可供验证。旧混合预览没有声称提供完整的 release checksum 集合或 SBOM；撤回不会使这些文件成为生产版本。',
        '后续发布必须说明产品或组件、准确版本、平台、内容与验证材料。完整 Nimi 下载必须包含 Desktop、Runtime 和 Avatar；组件下载必须说明其较小的交付范围。',
        '已下载的旧 Windows 预览 PE 使用 NotSigned 状态，旧 macOS 候选使用没有 Apple TeamIdentifier 的 ad-hoc 签名。这些状态不具备生产信任。',
      ],
      items: [
        '来源：仅使用官方 GitHub 仓库与 Release 页面。',
        '身份：核对发布对象、版本、平台与声明的内容。',
        '已签名发布：按代码签名政策核对该 Release 所属的 checksums、SBOM 与签名。',
      ],
    },
    providerTitle: 'Windows 代码签名',
    providerLabel: 'Planned code-signing provider (application not submitted)',
    attribution: 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    disclaimer: 'No current Nimi artifact should be treated as SignPath-signed unless its Authenticode signature verifies successfully.',
    systemChanges: {
      title: '已下载的旧预览与开发构建',
      paragraphs: [
        '已撤回的 Windows source-local Kit 包通过 npm 安装，不会安装 Nimi Home、Windows 服务或证书，也不会修改 PATH 或 Program Files。',
        '如果已下载旧的便携 Runtime 启动包，文档中的 .\\nimi.exe version --json 命令不会安装服务，也不会修改 PATH、Program Files、ProgramData 或证书存储；它不会使 protected-local production 可用。',
        '如果已经安装旧 macOS 开发候选，其开发命名空间包括 _nimiruntimedev、ai.nimi.runtime.dev、/Applications/Nimi Dev.app、/Library/Application Support/Nimi/RuntimeDev、/usr/local/libexec/nimi-macos-dev-security、本地 Runtime sockets，以及 root-owned /private/var/run/nimi-macos-dev-security.lock operation lock。请按下方说明清理。',
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
        '如果已安装旧 Windows source-local Kit 包，在对应项目中用 npm uninstall 移除。',
        '旧的便携 Windows Runtime 启动包没有卸载程序。关闭所有运行中的 nimi.exe process，再删除解压目录；文档中的 version 命令不会创建服务或受保护产品状态。',
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
        '旧的混合开发者预览正在撤回，以纠正发布身份；尚未发布新的公开 unsigned Runtime bootstrap。SignPath Foundation 申请尚未提交，Nimi 尚未获批，SignPath 也尚未提供生产代码签名或项目证书。',
        '当前没有已发布的 production-signed Windows release。本地自签只用于同机开发；公开 unsigned preview 使用独立标记的 GitHub prerelease，绝不声称 production identity。',
        '未接入 production Authenticode signer 时，signed RC 与 Stable publication 必须保持阻断。显式 unsigned bootstrap preview 不以该 signer 为前置，但它不可晋级，也不会使 protected-local production 可用。',
        '在获批并接通 production workflow 前，Nimi 不会暗示任何制品已由 SignPath 或 SignPath Foundation 签名。',
      ],
    },
    attributionTitle: 'Planned attribution',
    attributionIntro: '如果申请获批并正式启用 production signing workflow，Nimi 计划使用以下归属语句：',
    attribution: 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    attributionPending: '这只是获批并启用生产签名后的计划归属。新的 Runtime 预览尚未发布，SignPath Foundation 申请尚未提交。',
    scope: {
      title: 'Scope of signed artifacts',
      paragraphs: [
        '初次 SignPath 申请范围只有一个 Nimi 自有 Windows x64 Runtime executable：nimi.exe。新的公开未签名启动包必须归属于 Runtime 发布身份，说明便携 ZIP 的内容，并保持 unsigned、不可晋升。',
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
        'Release PR 冻结所发布产品或组件的版本与 CHANGELOG。各阶段保留同一归属前缀：完整 Desktop + Runtime + Avatar 产品为 nimi/vX.Y.Z，Desktop 为 desktop/vX.Y.Z，Runtime 为 runtime/vX.Y.Z，各库使用自己的组件前缀。Unsigned preview 永远不是晋升输入；已签名 RC 必须重新构建生产签名制品。',
        '下一次 bootstrap 发布需要提供身份独立的 Windows x64 Runtime 预览。SignPath Foundation 申请与审批仍是单独的负责人操作；获批后构建和签署正式 Runtime，验证签名并取得证书的 SubjectPublicKeyInfo（SPKI）SHA-256，再发布 production protected-local package。未签名文件不会被追溯签名或晋级。',
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
    metadataBlocker: 'SignPath 批准、production signing、签名后验证及重新封装尚未接入。后续 Runtime 发布必须验证 PE Product Name、Product Version、架构与声明的签名状态；在真实签名发布路径完成并验证前，不会声称这些生产控制已生效。',
    verificationTitle: 'Verification instructions',
    verificationIntro: '运行下载的 Windows 文件前先验证。明确未签名的 runtime/vX.Y.Z-preview.N executable 预期为 NotSigned，不能建立生产信任；未来生产签名版本必须满足以下条件。PowerShell 随 Windows 提供，signtool 来自 Windows SDK。',
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
        '已撤回的便携 Runtime 启动包没有安装程序或服务。文档中的 .\\nimi.exe version --json 命令不创建 NimiRuntime service，也不修改 PATH、Program Files、ProgramData 或 Windows 证书存储，不会使 protected-local production 可用。',
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
        '如果已下载旧的便携 Runtime 启动包，关闭所有运行中的 nimi.exe process，再删除解压目录。它没有安装或卸载程序；文档中的 version 命令不创建服务或受保护产品状态。',
        '当前没有准入的 production uninstall flow。在真实流程覆盖停止并删除 NimiRuntime、删除安装文件、默认保留或由用户明确清理数据之前，production Windows installer 不能发布。',
        '清理开发原型需要 elevated PowerShell：停止 NimiRuntime、删除 NimiRuntime service、删除 %ProgramFiles%\\Nimi\\Runtime，再明确选择保留或删除 %ProgramData%\\Nimi\\Runtime\\Protected，其中包括 memory.db 及 repair backup/sidecar 文件；若原型安装过本地开发证书，还要按准确 thumbprint 从 LocalMachine Root 与 TrustedPublisher 删除。',
        '用户选择的 nimi_data 默认保留。只有用户明确决定后，才单独删除其中的模型、依赖、环境、Apps、账号、App/账号范围内的缓存数据，以及配置中的 logs/audit 根目录；当前没有独立的 shared cache 根目录。先备份所需内容；删除不可恢复。',
      ],
    },
    historical: {
      title: 'Historical unsigned releases',
      paragraphs: [
        '旧的仓库整体预览正在撤回。新预览必须使用产品或组件命名空间并说明实际交付内容；未签名文件不会被追溯描述为已签名，也不会成为 RC 或 Stable 制品。',
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
          <a className="release-primary-action" href={REPOSITORY_URL} aria-describedby="preview-scope preview-warning">
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

      <PageSection title={page.providerTitle}>
        <p className="release-label">{page.providerLabel}</p>
        <p><strong>{page.attribution}</strong></p>
        <p className="release-warning">{page.disclaimer}</p>
        <p><Link to="/code-signing">{shared.policy}</Link></p>
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

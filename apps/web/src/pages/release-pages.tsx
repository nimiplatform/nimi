import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, Clipboard, Code2, Laptop, Monitor, ShieldCheck, Terminal, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { withLocaleQuery } from '../landing/config/landing-links.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import {
  PublicSiteFooter,
  PublicSiteHeader,
  useResolvedPublicLinks,
} from './public-site-shell.js';
import { usePublicPageLocale } from './use-page-locale.js';

// @nimi-authority: rule.nimi.platform.core-protocol.p-arch-001a
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-positioning
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-owner-boundary
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-supported-completeness
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-028-release-tag-namespace
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-pkgrel-009
const REPOSITORY_URL = 'https://github.com/nimiplatform/nimi';
const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const PUBLIC_BETA_VERSION = '0.2.4';
const PUBLIC_BETA_ASSET_URL = `${RELEASES_URL}/download/${encodeURIComponent(`nimi/v${PUBLIC_BETA_VERSION}`)}`;
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
  title: string;
  windowsAction: string;
  macosAction: string;
  releaseAction: string;
  scope: string;
  warning: string;
  installationGuide: string;
  desktop: { title: string; signInRequirement: string };
  requirements: Record<'windows' | 'macos' | 'linux', string>;
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
  linksTitle: string;
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
        'Find Nimi installers, platform requirements, and release verification guidance.',
      canonical: 'https://nimi.ai/download',
    },
    title: 'Download Nimi',
    scope: `Public Beta v${PUBLIC_BETA_VERSION} for Apple Silicon Macs and Windows x86_64.`,
    windowsAction: 'Download for Windows x86_64 (.exe)',
    macosAction: 'Download for Apple Silicon Mac (.pkg)',
    releaseAction: 'View metadata & assets on GitHub Releases',
    warning: 'Windows install note: if SmartScreen shows “Windows protected your PC”, click “More info → Run anyway” to continue. The Windows Beta installer has no Authenticode signature. Do not install a development root certificate or turn off OS security controls to run it.',
    installationGuide: 'Installation and verification',
    desktop: {
      title: 'Nimi Desktop',
      signInRequirement: 'On first launch, sign in to your Nimi account in your browser.',
    },
    requirements: {
      windows: 'Windows 10 (2004) or later · x86_64',
      macos: 'macOS 13 or later · Apple Silicon',
      linux: 'No installer',
    },
  },
  policy: {
    linksTitle: 'Official links',
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
      description: '查找 Nimi 安装包、系统要求与版本校验说明。',
      canonical: 'https://nimi.ai/download',
    },
    title: '下载 Nimi',
    scope: `公开 Beta v${PUBLIC_BETA_VERSION}，适用于 Apple Silicon Mac 和 Windows x86_64。`,
    windowsAction: '下载 Windows 安装包 (.exe)',
    macosAction: '下载 macOS 安装包 (.pkg)',
    releaseAction: '查看 GitHub Releases 校验元数据与资产',
    warning: 'Windows 安装提示：首次运行安装程序时若弹出“Windows 已保护你的电脑”，点击“更多信息 → 仍要运行”即可正常安装。Windows Beta 安装包尚无 Authenticode 签名。请勿为此安装开发根证书或关闭系统安全防护。',
    installationGuide: '安装说明与校验',
    desktop: {
      title: 'Nimi 桌面版',
      signInRequirement: '首次使用需在浏览器登录 Nimi 账号。',
    },
    requirements: {
      windows: 'Windows 10（2004）或更高版本 · x86_64',
      macos: 'macOS 13 或更高版本 · Apple Silicon',
      linux: '暂无安装包',
    },
  },
  policy: {
    linksTitle: '官方入口',
    meta: {
      title: '代码签名政策 | Nimi',
      description: "Nimi 代码签名政策：当前公开 Beta 的签名与元数据校验机制、计划中的 SignPath 归属、签名范围、发布控制与验证方法。",
      canonical: 'https://nimi.ai/code-signing',
    },
    kicker: '信任与发布完整性',
    title: '代码签名政策',
    intro: "本政策定义由 Nimi 开源仓库构建的发布制品的代码签名与校验边界，说明当前公开 Beta（nimi/v0.2.4）的信任建立方式，并将现行机制与计划接入的 SignPath Windows Authenticode 签名明确区分。",
    statusTitle: "公开 Beta 校验与 Windows 签名状态",
    statusBody: "当前 Beta 为 macOS arm64 与 Windows x86_64 提供签名更新清单。Windows 安装包尚无 Authenticode 签名，也没有 SignPath 签名。",
    status: {
      title: '当前状态',
      paragraphs: [
        "2026 年 10 月 14 日，Nimi 在官方 GitHub Releases 发布了不可变公开 Beta 预发布版 nimi/v0.2.4，提供 macOS arm64（Nimi-0.2.4-macos-arm64.pkg）与 Windows x86_64（Nimi-0.2.4-windows-amd64.exe）安装包。双平台均随附 build metadata，以及经仓库平台 Ed25519 公钥验签的 update manifest（channel=beta，最低系统版本分别为 macOS 13.0 与 Windows 10 10.0.19041）。目前尚无已确认接入的正式 SignPath Windows 代码签名。",
        "平台签名元数据（Ed25519）严格绑定制品的精确 SHA-256、文件大小与 cohort，但不等同于 Windows Authenticode。nimi/v0.2.4 的 Windows x86_64 Beta 安装程序明确为未签名状态（NotSigned），且不使用或要求任何本地开发自签证书。根据 P-SUPD-012，Windows 未签名 Beta 通过校验平台 Ed25519 签名元数据、完整 Windows installed inventory JSON，以及受保护 Program Files 所有权与锁定字节来建立受保护本地信任。",
        "在 macOS arm64 平台，发行脚本要求准入的 PKG 安装包完成 Apple Developer ID 签名、公证与钉合（staple）。在 Windows 平台，具备 Authenticode 签名的 RC 与 Stable 正式版仍以接入正式生产签名服务为前提。beta 通道与 Stable 稳定通道相互独立，单纯的 NotSigned 状态或任意未签名文件本身绝不会获得受保护本地权限。",
        '在获批并接通 production workflow 前，Nimi 不会暗示任何制品已由 SignPath 或 SignPath Foundation 签名。',
      ],
    },
    attributionTitle: '计划中的归属声明',
    attributionIntro: '如果申请获批并正式启用 production signing workflow，Nimi 计划使用以下归属语句：',
    attribution: 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.',
    attributionPending: "上述归属声明仅在正式获批并接通 SignPath 生产签名工作流后适用。当前 nimi/v0.2.4 中的 Windows Beta 制品未进行 Authenticode 签名，不包含 SignPath 签名。",
    scope: {
      title: '签名制品范围',
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
      title: '构建来源与发布流程',
      paragraphs: [
        '源代码仓库是 https://github.com/nimiplatform/nimi。GitHub Actions 是唯一 production build system，production signing 不接受开发者工作站任意上传的二进制。',
        "每次发布均冻结所声明产品或组件的版本。标签保留归属前缀：完整 Desktop + Runtime + Avatar 产品为 nimi/v<version>（如 nimi/v0.2.4），Desktop 为 desktop/v<version>，Runtime 为 runtime/v<version>，各库使用各自受治理的组件前缀。发布阶段由 prerelease 标记与签名元数据中的 metadata.channel（如 channel=beta）决定，而非仅看标签后缀。未进行 Authenticode 签名的 Windows Beta 二进制文件绝不会直接晋升为已签名的 RC 或 Stable 版本。",
        "在当前公开 Beta 发布流程中，GitHub Actions 构建 macOS arm64 PKG 与 Windows x86_64 安装程序，生成平台 build metadata 与 Windows installed inventory JSON，并使用平台 Ed25519 密钥签署 update manifest。未签名的 Windows 二进制文件绝不会被追溯补签或直接晋升为稳定版。",
        '未来每次 SignPath signing request 都必须由人工明确批准。任何 production signing workflow 与全部 build scripts 都必须跟源码一起接受仓库 review；production SignPath workflow 当前尚未接入。',
      ],
    },
    team: {
      title: '团队角色与审批职责',
      paragraphs: ['Nimi 目前是由已注册主体 Nimi Network Limited 支持的单维护者开源项目。'],
      items: [
        'Authors / Committers：@snowzane 负责项目代码的创作与提交。',
        'Reviewers：@snowzane 在 merge 前审查外部贡献。',
        'Signing Approvers：@snowzane 是指定的唯一 signing approver；在 provider 与受保护 workflow 可用前，不存在可发起的 production signing request。',
        'Signing approval 是一次明确的 release 操作。GitHub commit 权限本身不等于批准 signing request；当前同一名维护者同时承担两个角色。',
      ],
    },
    access: {
      title: '多因素认证与访问控制',
      paragraphs: [
        'GitHub 组织当前强制成员启用 MFA。SignPath access 尚未授予；未来任何 SignPath membership 或 production-signing access 都必须在该成员启用并验证 MFA 之后才能授予。',
        'Signing approver assignment 与普通 contribution permission 分开，每次请求均需 approver 明确操作。SignPath/GitHub token 不进入仓库；正式启用前，任何 signing credential 都必须限制在受保护 workflow 内。',
        "受保护的 SignPath 签名环境及其人工批准规则当前尚未配置；在完成配置前，具备 Authenticode 签名的 Windows RC 与 Stable 版本保持阻断（当前 Windows Beta 依 P-SUPD-012 以未签名安装包发布）。",
      ],
    },
    metadata: {
      title: '制品身份与元数据校验',
      paragraphs: [
        "Beta 的签名更新清单绑定产品版本、通道、平台、组件组合、安装包摘要与大小，以及兼容性要求。构建元数据与 Windows 安装清单是另外的发布资产。后续 Authenticode 签名还需满足声明的 PE 身份、SHA-256 签名与 RFC 3161 时间戳要求。",
        "在当前 Beta 中，发布准入要求 update manifest 通过 schema、freshness 与平台公钥 Ed25519 验签，并与制品哈希和 installed inventory 精确匹配；当前版本不单独发布独立的 checksums 文本文件或 SBOM。在未来准入具备 Authenticode 签名的 Windows 稳定版前，工作流还必须在签名后复核所有 Authenticode 签名并发布 SHA-256 校验清单、SBOM 与配套校验材料；签名身份、版本或哈希任一不匹配均会阻断发布。",
      ],
    },
    metadataBlocker: "正式的 SignPath Windows Authenticode 签名工作流尚未接入。在该签名路径完成实现与验证前，Windows Beta 安装包保持明确的 Authenticode 未签名状态，并依据 P-SUPD-012 通过平台签名元数据与安装清单校验建立信任。",
    verificationTitle: '安装包校验说明',
    verificationIntro: "运行下载的 Nimi 安装包前请先完成校验。对于当前公开 Beta（nimi/v0.2.4），Nimi-0.2.4-windows-amd64.exe 的 Authenticode 状态预期为 NotSigned；请对照同一 Release 中经 Ed25519 签名的 Windows update 清单核验其 SHA-256 摘要与字节大小。未来启用正式 Windows Authenticode 签名后，还需满足下列 Authenticode 校验项。",
    verificationChecks: [
      "当前 Beta：update manifest 的 Ed25519 签名可通过仓库平台公钥验证，且 channel=beta。",
      "未来 Authenticode 签名版本：Authenticode Status 为 Valid，且仅在正式启用 SignPath 后 Publisher 为 SignPath Foundation（当前 Windows Beta 为 NotSigned）。",
      "资产版本、平台及最低系统版本要求（macOS 13.0 或 Windows 10.0.19041）与发布元数据一致。",
      "安装包与元数据文件来自 https://nimi.ai/download 或 https://github.com/nimiplatform/nimi/releases。",
      "文件的 SHA-256 摘要与字节大小同该 Release 随附的 build 与 update 元数据 JSON 完全一致。",
    ],
    privacy: {
      title: '隐私与网络行为边界',
      paragraphs: [
        'Local-first 不等于永不联网。本地功能与本地 Runtime 会在设备上处理符合条件的任务；用户明确选择 cloud provider 后，请求内容与必要 metadata 会发送到该 provider，并受其条款约束。',
        'Realm/account 操作会向 Nimi Realm 服务发送完成认证、账号管理、生态身份和所选同步所需的信息。网站 analytics、cookies、日志和 browser storage 以 Privacy Policy 为准。',
      ],
    },
    system: {
      title: '系统变更与目录说明',
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
      title: '卸载与清理指引',
      paragraphs: [
        "卸载或恢复公开 Beta 时，请参照对应版本的说明与官方支持。下方开发原型的历史清理命令仅适用于那些旧构建。",
        "用户数据（nimi_data）：用户选定的 nimi_data 根目录与程序文件分离且默认保留。仅在备份所需数据并由用户明确决定后，才可单独删除其中的模型、依赖、环境、应用、账号、范围缓存或 logs/audit 目录；删除操作不可恢复。",
        "仅限历史 Windows 本地开发原型：若此前运行过早期本地开发服务原型，请使用管理员 PowerShell 停止并删除 NimiRuntime 服务，删除 %ProgramFiles%\\Nimi\\Runtime，并决定保留或删除 %ProgramData%\\Nimi\\Runtime\\Protected（含 memory.db 及修复备份/sidecar 文件）。若该原型曾导入本地开发证书，请按精确 thumbprint 从 LocalMachine Root 与 TrustedPublisher 中移除（公开 Beta 安装包不安装开发证书，无需为卸载该安装包执行此操作）。",
        "历史已撤回预览：若下载过早期已撤回的便携式 Windows Runtime 解压包，关闭运行中的 nimi.exe 进程并删除解压文件夹即可；早期源码本地 npm Kit 包可在对应项目中执行 npm uninstall 移除。",
      ],
    },
    historical: {
      title: '历史未签名版本说明',
      paragraphs: [
        "早期混装的仓库整体预览版本均已撤回。当前公开 Beta 使用明确的产品标签（如 nimi/v0.2.4）与平台签名元数据（channel=beta）声明其交付范围与资产。未进行 Authenticode 签名的 Windows Beta 二进制文件绝不会被追溯描述为已签名，也不会直接成为 RC 或 Stable 制品。",
        "Windows 文件的 Authenticode 签名状态须对单文件执行 Authenticode 验证判断，发布清单完整性与所属通道则通过版本随附的 Ed25519 签名元数据核验，均不能仅凭版本号字符串、文件名或发布日期推断。",
      ],
    },
    incident: {
      title: '吊销与安全事件响应',
      paragraphs: [
        'SignPath Foundation 或项目可因滥用、违规或 credential compromise 撤销签名授权。发现签名异常时，Nimi 会停止分发、撤下受影响 artifact、调查 release path，并在恢复分发前发布 security advisory。',
        '请通过 GitHub Security Advisories 或 security@nimi.ai 私下报告签名或安全问题。',
      ],
    },
    license: {
      title: '开源许可证与源码边界',
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
  hero?: Pick<PolicyCopy, 'kicker' | 'title' | 'intro' | 'statusTitle' | 'statusBody'>;
  downloadHeader?: boolean;
  mainClassName?: string;
  children: ReactNode;
}) {
  const copy = PUBLIC_PAGE_CONTENT[props.locale].shared;
  const links = useResolvedPublicLinks(props.locale);
  usePageMetadata(props.meta, props.locale);

  return (
    <div
      className={props.downloadHeader ? 'story-site release-page-shell download-page-shell' : 'story-site release-page-shell'}
      lang={props.locale === 'zh' ? 'zh-CN' : 'en'}
      // See landing App.tsx: suppress native drag of selected text, which
      // hangs software-rendered environments. Selection and copy are intact.
      onDragStart={(event) => event.preventDefault()}
    >
      <a href="#release-main" className="skip-link">{copy.skipToContent}</a>
      <PublicSiteHeader
        locale={props.locale}
        onLocaleChange={props.onLocaleChange}
        activePath={props.downloadHeader ? '/download' : '/code-signing'}
        navId={props.downloadHeader ? 'download-navigation' : 'policy-navigation'}
        className="download-header"
      />

      <main id="release-main" className={props.mainClassName ?? 'release-container release-main'}>
        {props.hero ? (
          <>
            <div className="release-hero">
              <p className="release-kicker">{props.hero.kicker}</p>
              <h1>{props.hero.title}</h1>
              <p className="release-intro">{props.hero.intro}</p>
              <aside className="release-status" aria-label={copy.currentStatus}>
                <span>{copy.currentStatus}</span>
                <strong>{props.hero.statusTitle}</strong>
                <p>{props.hero.statusBody}</p>
              </aside>
              <p className="release-reviewed">{copy.reviewed}</p>
            </div>
            <article className="release-card">{props.children}</article>
          </>
        ) : props.children}
      </main>

      <PublicSiteFooter locale={props.locale} links={links} />
    </div>
  );
}

const DESKTOP_PLATFORMS = [
  { id: 'windows', name: 'Windows', icon: Monitor, asset: `Nimi-${PUBLIC_BETA_VERSION}-windows-amd64.exe` },
  { id: 'macos', name: 'macOS', icon: Laptop, asset: `Nimi-${PUBLIC_BETA_VERSION}-macos-arm64.pkg` },
  { id: 'linux', name: 'Linux', icon: Terminal, asset: null },
] as const;

type DetectedPlatform = 'windows' | 'macos' | 'mobile' | 'linux' | null;

function detectVisitorPlatform(): DetectedPlatform {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod|android/.test(ua)) return 'mobile';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return null;
}

const DOWNLOAD_ONBOARDING_STEPS: Readonly<Record<LandingLocale, {
  recommendedBadge: string;
  mobileHint: string;
  copyLinkLabel: string;
  copiedLinkLabel: string;
  intelMacNote: string;
  guideTitle: string;
  steps: ReadonlyArray<{ title: string; body: string }>;
}>> = {
  zh: {
    recommendedBadge: '当前设备推荐',
    mobileHint: '你当前正在手机或平板上浏览。Nimi Beta 需安装在桌面电脑上，你可以复制下载页链接发送到电脑打开。',
    copyLinkLabel: '复制下载页链接到电脑',
    copiedLinkLabel: '下载页链接已复制',
    intelMacNote: 'macOS 安装包当前仅支持 Apple Silicon（M1/M2/M3/M4 芯片），暂未提供 Intel Mac 构建。',
    guideTitle: '三步完成安装与首次启动',
    steps: [
      {
        title: '01 · 下载并运行安装程序',
        body: 'macOS 双击 .pkg 按向导完成安装；Windows 运行 .exe 时若弹出 SmartScreen 提示，点击“更多信息 → 仍要运行”即可（请勿安装任何自签根证书）。',
      },
      {
        title: '02 · 在浏览器登录 Nimi 账号',
        body: '首次启动 Nimi Home 会打开系统默认浏览器完成登录授权，建立受保护的本机所有者会话。',
      },
      {
        title: '03 · 配置模型并开启伙伴对话',
        body: '在 Nimi Home 中选择本机模型或填入自有云服务密钥，即可开始对话或从桌面目录安装应用。',
      },
    ],
  },
  en: {
    recommendedBadge: 'Recommended for this device',
    mobileHint: 'You’re browsing on a mobile device. Nimi Beta installs on a desktop computer—copy this page link to open on your Mac or Windows PC.',
    copyLinkLabel: 'Copy download link for desktop',
    copiedLinkLabel: 'Download link copied',
    intelMacNote: 'The macOS installer currently requires Apple silicon (M1/M2/M3/M4); Intel Macs are not supported in this Beta.',
    guideTitle: 'Install & get started in 3 steps',
    steps: [
      {
        title: '01 · Run the desktop installer',
        body: 'On macOS, open the .pkg installer; on Windows, run the .exe installer—if SmartScreen prompts, choose “More info → Run anyway” (never install a self-signed root certificate).',
      },
      {
        title: '02 · Sign in via your browser',
        body: 'On first launch, Nimi Home opens your browser to sign in to your Nimi account and bind your protected local session.',
      },
      {
        title: '03 · Configure AI & explore apps',
        body: 'Set up a local model or connect your own cloud service key inside Nimi Home, then start chatting or install catalog apps.',
      },
    ],
  },
};

export function DownloadPage() {
  const [locale, setLocale] = usePublicPageLocale();
  return <DownloadPageView locale={locale} onLocaleChange={setLocale} />;
}

export function DownloadPageView({
  locale,
  onLocaleChange,
  initialPlatform,
}: {
  locale: LandingLocale;
  onLocaleChange: (locale: LandingLocale) => void;
  initialPlatform?: DetectedPlatform;
}) {
  const page = PUBLIC_PAGE_CONTENT[locale].download;
  const shared = PUBLIC_PAGE_CONTENT[locale].shared;
  const onboarding = DOWNLOAD_ONBOARDING_STEPS[locale];
  const [detectedPlatform, setDetectedPlatform] = useState<DetectedPlatform>(initialPlatform ?? null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (initialPlatform === undefined) {
      setDetectedPlatform(detectVisitorPlatform());
    }
  }, [initialPlatform]);

  const copyDownloadUrl = async () => {
    try {
      await navigator.clipboard.writeText('https://nimi.ai/download');
      setCopiedLink(true);
    } catch {
      setCopiedLink(false);
    }
  };

  const windowsAssetHref = `${PUBLIC_BETA_ASSET_URL}/Nimi-${PUBLIC_BETA_VERSION}-windows-amd64.exe`;
  const macosAssetHref = `${PUBLIC_BETA_ASSET_URL}/Nimi-${PUBLIC_BETA_VERSION}-macos-arm64.pkg`;
  const showWindowsHeroCta = detectedPlatform === 'windows' || detectedPlatform === null;
  const showMacosHeroCta = detectedPlatform === 'macos' || detectedPlatform === null;

  return (
    <PageShell
      locale={locale}
      onLocaleChange={onLocaleChange}
      meta={page.meta}
      downloadHeader
      mainClassName="release-container download-main"
    >
      <div className="download-hero">
        <div className="download-hero-copy">
          <h1>{page.title}</h1>
          <p id="preview-scope" className="download-scope">
            {page.scope} {page.desktop.signInRequirement}
          </p>
          <p id="preview-warning" className="download-warning">
            <TriangleAlert size={18} aria-hidden="true" />
            <span>{page.warning}</span>
          </p>
          <div className="download-hero-actions">
            {showWindowsHeroCta ? (
              <a
                className="release-primary-action"
                href={windowsAssetHref}
                aria-describedby="preview-scope preview-warning"
              >
                <ArrowDownToLine size={17} aria-hidden="true" />
                <span>{page.windowsAction}</span>
              </a>
            ) : null}
            {showMacosHeroCta ? (
              <a
                className="release-primary-action"
                href={macosAssetHref}
                aria-describedby="preview-scope"
              >
                <ArrowDownToLine size={17} aria-hidden="true" />
                <span>{page.macosAction}</span>
              </a>
            ) : null}
            <a
              className="release-secondary-action"
              href={RELEASES_URL}
              aria-describedby="preview-scope preview-warning"
            >
              <span>{page.releaseAction}</span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
          {detectedPlatform === 'mobile' ? (
            <div className="download-mobile-callout" role="status">
              <p>{onboarding.mobileHint}</p>
              <button type="button" className="story-button story-button-outline" onClick={copyDownloadUrl}>
                {copiedLink ? <Check size={15} aria-hidden="true" /> : <Clipboard size={15} aria-hidden="true" />}
                <span>{copiedLink ? onboarding.copiedLinkLabel : onboarding.copyLinkLabel}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <section className="download-group" aria-label={page.title}>
        <div className="download-card-grid">
          <section className="download-panel" aria-labelledby="download-desktop">
            <h2 id="download-desktop">{page.desktop.title}</h2>
            <p className="download-sign-in">{page.desktop.signInRequirement}</p>
            <dl className="download-platform-list">
              {DESKTOP_PLATFORMS.map(({ id, name, icon: Icon, asset }) => {
                const recommended = Boolean(asset && detectedPlatform === id);
                return (
                  <div
                    className={`download-platform-row${asset ? '' : ' is-unavailable'}${recommended ? ' is-recommended' : ''}`}
                    key={id}
                  >
                    <dt id={`download-${id}`}>
                      <span className="download-platform-icon"><Icon size={22} aria-hidden="true" /></span>
                      <span className="download-platform-name">
                        <span className="download-platform-title-row">
                          {name}
                          {recommended ? (
                            <span className="download-recommended-pill">{onboarding.recommendedBadge}</span>
                          ) : null}
                        </span>
                        {asset ? <small id={`requirements-${id}`}>{page.requirements[id]}</small> : null}
                      </span>
                    </dt>
                    <dd id={asset ? undefined : `requirements-${id}`} className="download-platform-action">
                      {asset ? (
                        <a
                          id={`installer-${id}`}
                          className="download-installer"
                          href={`${PUBLIC_BETA_ASSET_URL}/${asset}`}
                          aria-labelledby={`installer-${id} download-${id}`}
                          aria-describedby={id === 'windows' ? 'requirements-windows preview-warning' : 'requirements-macos'}
                        >
                          {shared.download}
                          <ArrowDownToLine size={15} aria-hidden="true" />
                        </a>
                      ) : <span className="download-unavailable">{page.requirements[id]}</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="download-intel-note">{onboarding.intelMacNote}</p>
          </section>

          <section className="download-panel" aria-labelledby="download-resources">
            <h2 id="download-resources">{shared.docs}</h2>
            <div className="download-resource-list">
              <Link className="download-resource-row" to={withLocaleQuery('/code-signing', locale)}>
                <span className="download-resource-icon"><ShieldCheck size={21} aria-hidden="true" /></span>
                <span className="download-resource-copy">
                  <strong>{page.installationGuide}</strong>
                  <small>SHA-256 · Ed25519</small>
                </span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
              <a className="download-resource-row" href={SECURITY_ADVISORY_URL}>
                <span className="download-resource-icon"><TriangleAlert size={21} aria-hidden="true" /></span>
                <span className="download-resource-copy">
                  <strong>{shared.security}</strong>
                  <small>{shared.securityAdvisoryDetail}</small>
                </span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
              <a className="download-resource-row" href={REPOSITORY_URL}>
                <span className="download-resource-icon"><Code2 size={21} aria-hidden="true" /></span>
                <span className="download-resource-copy">
                  <strong>{shared.source}</strong>
                  <small>nimiplatform/nimi</small>
                </span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
          </section>
        </div>

        <section className="download-onboarding-card" aria-labelledby="download-onboarding-heading">
          <h2 id="download-onboarding-heading">{onboarding.guideTitle}</h2>
          <div className="download-onboarding-grid">
            {onboarding.steps.map((step) => (
              <article key={step.title} className="download-onboarding-step">
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>
      </section>
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
      hero={page}
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

      <PageSection title={page.linksTitle}>
        <OfficialLinks copy={shared} />
      </PageSection>
    </PageShell>
  );
}

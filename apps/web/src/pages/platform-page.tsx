import { useMemo } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  Cpu,
  Globe,
  Laptop,
  Radio,
  Server,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { withLocaleQuery } from '../landing/config/landing-links.js';
import { StoryContentCheck } from '../landing/components/story/story-security.js';
import { getStoryCopy, type StoryText } from '../landing/content/story-copy.js';
import {
  PROVIDER_CAPABILITIES,
  type AdmittedCapability,
} from '../landing/generated/index.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import { CAPABILITY_LABELS } from './informational-content.js';
import {
  PublicSiteShell,
  usePublicDocumentMetadata,
  useResolvedPublicLinks,
} from './public-site-shell.js';
import { usePublicPageLocale } from './use-page-locale.js';

// @nimi-authority: rule.nimi.platform.core-protocol.p-arch-001a
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-positioning
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-owner-boundary
const ACTIVE_CAPABILITIES: ReadonlyArray<{
  id: AdmittedCapability;
  group: 'text' | 'audio' | 'visual';
}> = [
  { id: 'text.generate', group: 'text' },
  { id: 'text.embed', group: 'text' },
  { id: 'image.generate', group: 'visual' },
  { id: 'video.generate', group: 'visual' },
  { id: 'vision.locate', group: 'visual' },
  { id: 'realtime.interact', group: 'visual' },
  { id: 'audio.synthesize', group: 'audio' },
  { id: 'audio.transcribe', group: 'audio' },
  { id: 'music.generate', group: 'audio' },
  { id: 'voice.create', group: 'audio' },
  { id: 'audio.separate', group: 'audio' },
];

const PLATFORM_COPY: Readonly<Record<LandingLocale, {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  title: string;
  lead: string;
  downloadCta: string;
  sourceCta: string;
  specCta: string;
  domainsEyebrow: string;
  domainsTitle: string;
  domainsBody: string;
  domains: ReadonlyArray<{
    id: string;
    badge: string;
    title: string;
    summary: string;
    bullets: ReadonlyArray<string>;
  }>;
  openSourceBoundary: string;
  matrixEyebrow: string;
  matrixTitle: string;
  matrixBody: string;
  groups: Record<'text' | 'audio' | 'visual', string>;
  localBadge: (count: number) => string;
  remoteBadge: (count: number) => string;
  costBoundaryTitle: string;
  costBoundaryBody: string;
  trustEyebrow: string;
  trustTitle: string;
  trustBody: string;
  trustCards: ReadonlyArray<{ title: string; body: string }>;
  signingLinkLabel: string;
  topologyEyebrow: string;
  topologyTitle: string;
  topologyBody: string;
  topologyStages: ReadonlyArray<{
    stage: string;
    status: string;
    title: string;
    body: string;
  }>;
}>> = {
  zh: {
    metaTitle: '平台底座与架构 | Nimi',
    metaDescription: '了解 Nimi 的 Runtime、Cognition、Realm 三域架构、11 项多模态能力路由矩阵、权限信任边界与跨终端拓扑。',
    eyebrow: '平台底座 · 架构与信任边界',
    title: '面向个人设备的三域 AI 底座',
    lead: 'Nimi 将模型算力调度（Runtime）、可溯源伙伴记忆（Cognition）与生态身份服务（Realm）解耦为清晰契约，让上层应用共享连续上下文，同时守住本机数据控制权。',
    downloadCta: '下载公开 Beta',
    sourceCta: '查看开源仓库',
    specCta: '查看平台规范',
    domainsEyebrow: '三域职责划分',
    domainsTitle: 'Runtime · Cognition · Realm',
    domainsBody: '每一层都有明确的所有权边界：算力与长期记忆驻留在你的设备上，账号与共享世界图谱按需与托管服务交互。',
    domains: [
      {
        id: 'runtime',
        badge: '开源 · Apache-2.0 · 本机执行面',
        title: 'Nimi Runtime',
        summary: '运行在个人电脑上的多模态 AI 算力调度中心与受保护会话守卫。',
        bullets: [
          '统一纳管本机推理引擎与用户配置的云端连接器，按模态声明路由调用。',
          '基于受保护本地会话校验应用声明权限，拒绝未授权或隐式越权请求。',
          '支持设备所有者通过受准入客户端安全连回家庭主 Runtime。',
        ],
      },
      {
        id: 'cognition',
        badge: '开源 · Apache-2.0 · 记忆治理层',
        title: 'Nimi Cognition',
        summary: '围绕每位本地智能体（Local Agent）构建的可审查、可修正长期记忆引擎。',
        bullets: [
          '每条记忆保留来源记录，用户可随时查看、编辑修正或彻底删除。',
          '支持在已授权的应用（如 Nimi Home 与织羽）之间延续同一位伙伴的上下文。',
          '严格隔离应用私有业务库——共享伙伴记忆不等于合并各应用的本地数据。',
        ],
      },
      {
        id: 'realm',
        badge: '托管服务 · 账号与世界图谱',
        title: 'Nimi Realm',
        summary: '承载 Nimi 账号认证、社交隐私关系以及共享世界与角色设定的在线服务层。',
        bullets: [
          '通过浏览器完成安全登录、双因素验证、会话管理与主 Runtime 绑定校验。',
          '维护公开世界设定、角色资料与好友隐私投影，不包含网页在线聊天壳。',
          '仅同步身份与所选生态元数据；本机模型与 nimi_data 默认留在本地设备。',
        ],
      },
    ],
    openSourceBoundary: '开源边界说明：Runtime、Cognition、Desktop、TypeScript SDK、Kit 与 App Tools 均在公开仓库以 Apache-2.0 / MIT 许可证开放源码；Realm 服务端实现由 Nimi Network Limited 私有维护。',
    matrixEyebrow: '单一事实源能力矩阵',
    matrixTitle: '11 项常用多模态 AI 能力',
    matrixBody: '下表按公开 Runtime 配置展示这些能力的路由。可用的本地引擎和云端连接器因能力而异，实际执行取决于应用权限与用户配置。',
    groups: {
      text: '文本生成与向量嵌入',
      visual: '视觉、视频与实时多模态',
      audio: '语音、音乐与声线创作',
    },
    localBadge: (count) => (count > 0 ? `支持本机引擎 (${count})` : '云端连接器路由'),
    remoteBadge: (count) => `${count} 类云端连接器`,
    costBoundaryTitle: '费用与数据流向透明边界',
    costBoundaryBody: 'Nimi 本身免费。使用本机模型时推理在你的硬件上完成；当你主动选择云端服务时，请求所需的输入与上下文会发送给你所选的服务商并按其标准计费；第三方 App 是否收费由其发布者独立决定。',
    trustEyebrow: '调用治理与安全基线',
    trustTitle: '显式授权、发布验签与内容检查预览',
    trustBody: 'Nimi 对受管调用实施失败关闭（Fail-Closed）策略，并在源码构建中提供面向敏感凭证格式的内容检查开发预览。',
    trustCards: [
      {
        title: '应用最小声明权限',
        body: '每个 Nimi 应用必须在清单中声明所需 AI 能力、MCP 资料源或消息通道；未获当前受保护会话授权的调用会被直接拒绝。',
      },
      {
        title: 'Ed25519 清单验签与受保护目录',
        body: '公开 Beta（nimi/v0.2.4）的更新清单可用平台 Ed25519 公钥验签（P-SUPD-012）。清单记录安装包 SHA-256；Windows 安装文件清单单独发布。',
      },
    ],
    signingLinkLabel: '阅读完整代码签名与校验政策',
    topologyEyebrow: '跨终端连接拓扑',
    topologyTitle: '从个人桌面主机到多屏远端协同',
    topologyBody: '明确区分当前 Beta 已交付能力、受准入远端客户端形态与长期协议演进方向。',
    topologyStages: [
      {
        stage: '当前已交付 · Beta v0.2.4',
        status: '现已可用',
        title: '个人电脑主 Runtime（macOS arm64 & Windows x86_64）',
        body: '在 Apple Silicon Mac 或 Windows x86_64 电脑安装 Nimi Beta，通过桌面托管的 Nimi Home 配置本地模型或云端连接。应用目录与开发模式的可用性取决于应用、平台和主机版本。',
      },
      {
        stage: '跨设备直连 · 按客户端准入',
        status: '官网提供主 Runtime 管理入口',
        title: '受准入的客户端可直连电脑主 Runtime',
        body: '登录官网账号后，可在账号中心连接并管理已绑定的主 Runtime。首次连接需在电脑端确认，且客户端必须能直连主机。独立 Web 应用与 Android 应用需分别通过 Registry 准入，并遵循各自的操作范围。',
      },
      {
        stage: '长期底座演进 · 路线蓝图',
        status: '持续探索',
        title: '常驻家庭算力盒、座舱与具身终端',
        body: '依托与硬件解耦的开放协议契约，逐步向低功耗家庭常驻主机、车载空间与专用个人硬件延伸同一套记忆与能力底座。',
      },
    ],
  },
  en: {
    metaTitle: 'Platform Architecture & Foundation | Nimi',
    metaDescription: 'Explore Nimi’s Runtime, Cognition, and Realm three-domain architecture, 11-capability multimodal matrix, trust boundaries, and cross-terminal topology.',
    eyebrow: 'Platform Foundation · Architecture & Trust Boundaries',
    title: 'A three-domain AI foundation for personal devices',
    lead: 'Nimi separates compute scheduling (Runtime), inspectable companion memory (Cognition), and ecosystem identity (Realm) behind typed contracts—so apps share continuous context while you keep local control.',
    downloadCta: 'Download Public Beta',
    sourceCta: 'Browse Open-Source Repo',
    specCta: 'Read the platform specification',
    domainsEyebrow: 'Three-Domain Separation',
    domainsTitle: 'Runtime · Cognition · Realm',
    domainsBody: 'Each domain has a strict ownership boundary: compute and long-term companion memory live on your machine, while identity and shared world graphs interact explicitly with hosted services.',
    domains: [
      {
        id: 'runtime',
        badge: 'Open Source · Apache-2.0 · Local Execution Plane',
        title: 'Nimi Runtime',
        summary: 'The multimodal AI compute router and protected session guardian running on your personal computer.',
        bullets: [
          'Schedules local inference engines alongside user-configured cloud connectors across modality-typed contracts.',
          'Enforces per-app declared permissions in protected local sessions and fails closed on unauthorized calls.',
          'Supports authenticated direct owner connections back to your primary home Runtime.',
        ],
      },
      {
        id: 'cognition',
        badge: 'Open Source · Apache-2.0 · Memory Governance',
        title: 'Nimi Cognition',
        summary: 'Inspectable, user-correctable long-term memory scoped to each on-device Local Agent.',
        bullets: [
          'Every memory retains source provenance so you can inspect, edit, or delete what a companion remembers.',
          'Carries companion context across authorized apps such as Nimi Home and Zhiyu.',
          'Keeps each app’s own business database isolated—shared companion memory never merges private app storage.',
        ],
      },
      {
        id: 'realm',
        badge: 'Hosted Service · Identity & World Graph',
        title: 'Nimi Realm',
        summary: 'The online service layer for Nimi account authentication, social privacy controls, and shared worlds.',
        bullets: [
          'Handles browser sign-in, 2FA, session management, and verified primary Runtime binding.',
          'Maintains published world lore, persona registries, and friendship privacy projections without hosting web chat on nimi.ai.',
          'Syncs only identity and selected ecosystem metadata while local models and nimi_data stay on your computer.',
        ],
      },
    ],
    openSourceBoundary: 'Open-source boundary: Runtime, Cognition, Desktop, TypeScript SDK, Kit, and App Tools are open source in the public repository under Apache-2.0 / MIT licenses; the Realm backend implementation is privately operated by Nimi Network Limited.',
    matrixEyebrow: 'Config-Derived Capability Matrix',
    matrixTitle: '11 common multimodal AI capabilities',
    matrixBody: 'This selection shows routing from the public Runtime configuration. Local engines and cloud connectors vary by capability, and execution depends on app permissions and user configuration.',
    groups: {
      text: 'Text Generation & Embeddings',
      visual: 'Vision, Video & Realtime',
      audio: 'Speech, Music & Voice Design',
    },
    localBadge: (count) => (count > 0 ? `Local engines (${count})` : 'Cloud connector routed'),
    remoteBadge: (count) => `${count} cloud connectors`,
    costBoundaryTitle: 'Transparent cost & data-flow boundary',
    costBoundaryBody: 'Nimi itself is free. Local models run on your own hardware; when you select a cloud service, required inputs and context are sent to that provider under its pricing and terms; whether a third-party app charges is up to its publisher.',
    trustEyebrow: 'Invocation Governance & Safety',
    trustTitle: 'Explicit permissions, signed manifests & content-check preview',
    trustBody: 'Nimi enforces fail-closed boundaries on managed calls and includes a developer-preview content check for supported secret formats.',
    trustCards: [
      {
        title: 'Declared per-app permissions',
        body: 'Every Nimi App declares required AI capabilities, MCP sources, and messaging channels up front; ungranted calls are rejected by the protected session.',
      },
      {
        title: 'Ed25519 manifest verification',
        body: 'The platform’s Ed25519 public key verifies the Beta (nimi/v0.2.4) update manifests (P-SUPD-012). They bind each installer’s SHA-256 digest. The Windows installed file inventory is published separately.',
      },
    ],
    signingLinkLabel: 'Read the full Code Signing & Verification Policy',
    topologyEyebrow: 'Cross-Terminal Topology',
    topologyTitle: 'From your desktop hub to multi-screen continuity',
    topologyBody: 'A clear distinction between what ships in Beta v0.2.4 today, admitted remote client carriers, and long-term protocol direction.',
    topologyStages: [
      {
        stage: 'Shipping Today · Beta v0.2.4',
        status: 'Available now',
        title: 'Primary PC Runtime (macOS arm64 & Windows x86_64)',
        body: 'Install Nimi Beta on an Apple Silicon Mac or Windows x86_64 PC and configure local models or cloud connections in Desktop-hosted Nimi Home. Catalog and Developer Mode availability depends on the app, platform, and host version.',
      },
      {
        stage: 'Direct remote access · Admitted per client',
        status: 'Primary Runtime management on the website',
        title: 'Admitted clients can connect to your primary PC Runtime',
        body: 'Sign in to the account center to connect to and manage your account-bound Runtime. First use requires confirmation in Nimi Home, and the client must be able to reach the host directly. Standalone Web and Android apps require separate Registry admission and have their own operation scopes.',
      },
      {
        stage: 'Long-Term Direction · Architecture Roadmap',
        status: 'Future horizon',
        title: 'Always-on home hubs, cabins & dedicated hardware',
        body: 'Because capability and memory contracts are decoupled from UI shells, the same personal foundation can extend to dedicated home nodes and embedded terminals over time.',
      },
    ],
  },
};

export function PlatformPage() {
  const [locale, setLocale] = usePublicPageLocale();
  const copy = PLATFORM_COPY[locale];
  const capLabels = CAPABILITY_LABELS[locale];
  const storyCopy = getStoryCopy(locale);
  const t: StoryText = (key) => storyCopy[key];
  const links = useResolvedPublicLinks(locale);

  usePublicDocumentMetadata(copy.metaTitle, copy.metaDescription, '/platform', locale);

  const capabilityStats = useMemo(() => {
    return ACTIVE_CAPABILITIES.map(({ id, group }) => {
      let localCount = 0;
      let remoteCount = 0;
      for (const entry of PROVIDER_CAPABILITIES) {
        if (!entry.capabilities.includes(id)) continue;
        if (entry.runtimePlane === 'local') localCount += 1;
        else remoteCount += 1;
      }
      return {
        id,
        group,
        label: capLabels[id] ?? id,
        localCount,
        remoteCount,
      };
    });
  }, [capLabels]);

  const domainIcons = {
    runtime: Cpu,
    cognition: BrainCircuit,
    realm: Globe,
  } as const;

  const stageIcons = [Laptop, Smartphone, Radio] as const;

  return (
    <PublicSiteShell locale={locale} onLocaleChange={setLocale} activePath="/platform">
      <section className="public-hero-section">
        <div className="story-container">
          <div className="public-hero-header">
            <span className="public-eyebrow">{copy.eyebrow}</span>
            <h1>{copy.title}</h1>
            <p className="public-hero-lead">{copy.lead}</p>
            <div className="public-hero-actions">
              <Link to={links.downloadUrl} className="story-button">
                <span>{copy.downloadCta}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a href={links.githubUrl} className="story-button story-button-outline">
                <span>{copy.sourceCta}</span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
              <a href="https://github.com/nimiplatform/nimi/tree/main/.nimi/spec" className="story-button story-button-outline">
                <span>{copy.specCta}</span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="domains" className="public-page-section" aria-labelledby="domains-heading">
        <div className="story-container">
          <header className="story-heading">
            <span className="story-eyebrow">{copy.domainsEyebrow}</span>
            <h2 id="domains-heading">{copy.domainsTitle}</h2>
            <p>{copy.domainsBody}</p>
          </header>

          <div className="public-domain-grid">
            {copy.domains.map((domain) => {
              const Icon = domainIcons[domain.id as keyof typeof domainIcons] ?? Server;
              return (
                <article key={domain.id} className="public-domain-card" data-domain={domain.id}>
                  <div className="public-domain-card-top">
                    <span className="story-pillar-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <span className="public-domain-badge">{domain.badge}</span>
                  </div>
                  <h3>{domain.title}</h3>
                  <p className="public-domain-summary">{domain.summary}</p>
                  <ul className="public-bullet-list">
                    {domain.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>

          <p className="public-boundary-banner">{copy.openSourceBoundary}</p>
        </div>
      </section>

      <section id="capabilities" className="public-page-section public-section-tinted" aria-labelledby="capabilities-heading">
        <div className="story-container">
          <header className="story-heading">
            <span className="story-eyebrow">{copy.matrixEyebrow}</span>
            <h2 id="capabilities-heading">{copy.matrixTitle}</h2>
            <p>{copy.matrixBody}</p>
          </header>

          <div className="public-capability-groups">
            {(['text', 'visual', 'audio'] as const).map((groupKey) => (
              <div key={groupKey} className="public-capability-group">
                <h3>{copy.groups[groupKey]}</h3>
                <div className="public-capability-matrix">
                  {capabilityStats
                    .filter((item) => item.group === groupKey)
                    .map((item) => (
                      <div key={item.id} className="public-capability-row">
                        <div className="public-capability-row-title">
                          <strong>{item.label}</strong>
                          <code>{item.id}</code>
                        </div>
                        <div className="public-capability-row-planes">
                          <span
                            className={`public-plane-pill${item.localCount > 0 ? ' is-local' : ''}`}
                          >
                            {copy.localBadge(item.localCount)}
                          </span>
                          <span className="public-plane-pill is-remote">
                            {copy.remoteBadge(item.remoteCount)}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>

          <aside className="public-info-card public-cost-callout" aria-labelledby="cost-boundary-heading">
            <h3 id="cost-boundary-heading">{copy.costBoundaryTitle}</h3>
            <p>{copy.costBoundaryBody}</p>
          </aside>
        </div>
      </section>

      <section id="trust" className="public-page-section" aria-labelledby="trust-heading">
        <div className="story-container">
          <header className="story-heading">
            <span className="story-eyebrow">{copy.trustEyebrow}</span>
            <h2 id="trust-heading">{copy.trustTitle}</h2>
            <p>{copy.trustBody}</p>
          </header>

          <div className="public-two-column-cards">
            {copy.trustCards.map((card) => (
              <article key={card.title} className="public-info-card">
                <div className="public-card-icon-row">
                  <ShieldCheck size={20} aria-hidden="true" />
                  <h3>{card.title}</h3>
                </div>
                <p>{card.body}</p>
              </article>
            ))}
          </div>

          <div className="public-security-workbench-wrap">
            <StoryContentCheck key={locale} t={t} links={links} defaultOpen />
            <p className="public-availability-note">{t('security.noSandbox')}</p>
            <Link to={withLocaleQuery('/code-signing', locale)} className="story-link">
              <span>{copy.signingLinkLabel}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section id="topology" className="public-page-section public-section-tinted" aria-labelledby="topology-heading">
        <div className="story-container">
          <header className="story-heading">
            <span className="story-eyebrow">{copy.topologyEyebrow}</span>
            <h2 id="topology-heading">{copy.topologyTitle}</h2>
            <p>{copy.topologyBody}</p>
          </header>

          <div className="public-domain-grid">
            {copy.topologyStages.map((stage, index) => {
              const Icon = stageIcons[index] ?? Laptop;
              return (
                <article key={stage.title} className="public-domain-card">
                  <div className="public-domain-card-top">
                    <span className="story-pillar-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <span className={`public-domain-badge${index === 0 ? ' is-live' : ''}`}>
                      {stage.status}
                    </span>
                  </div>
                  <small className="public-stage-kicker">{stage.stage}</small>
                  <h3>{stage.title}</h3>
                  <p className="public-domain-summary">{stage.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </PublicSiteShell>
  );
}

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  Cpu,
  Globe,
  Laptop,
  Radio,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { withLocaleQuery } from '../landing/config/landing-links.js';
import { StoryContentCheck } from '../landing/components/story/story-security.js';
import { getStoryCopy, type StoryText } from '../landing/content/story-copy.js';
import { PROVIDER_CAPABILITIES } from '../landing/generated/index.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import { CAPABILITY_LABELS } from './informational-content.js';
import { PlatformCapabilityPreview } from './platform-capability-preview.js';
import { PLATFORM_CAPABILITIES, type CapabilityGroup, type CapabilityId } from './platform-capability-samples.js';
import {
  PublicSiteShell,
  usePublicDocumentMetadata,
  useResolvedPublicLinks,
} from './public-site-shell.js';
import { usePublicPageLocale } from './use-page-locale.js';

// @nimi-authority: rule.nimi.platform.core-protocol.p-arch-001a
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-positioning
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-owner-boundary
const CAPABILITY_GROUPS = ['text', 'visual', 'audio'] as const;
const ACTIVE_CAPABILITIES = CAPABILITY_GROUPS.flatMap((group) => (
  PLATFORM_CAPABILITIES[group].map((id) => ({ id, group }))
));

const DOMAIN_ICONS = { runtime: Cpu, cognition: BrainCircuit, realm: Globe } as const;
const STAGE_ICONS = { desktop: Laptop, remote: Smartphone, roadmap: Radio } as const;
const PLATFORM_CAPABILITY_LABELS: typeof CAPABILITY_LABELS = {
  ...CAPABILITY_LABELS,
  en: {
    ...CAPABILITY_LABELS.en,
    'text.generate': 'Text generation',
    'image.generate': 'Image generation',
    'video.generate': 'Video generation',
    'music.generate': 'Music generation',
    'realtime.interact': 'Realtime interaction',
  },
};

const PLATFORM_COPY: Readonly<Record<LandingLocale, {
  metaTitle: string;
  metaDescription: string;
  title: string;
  lead: string;
  downloadCta: string;
  sourceCta: string;
  specCta: string;
  domainsTitle: string;
  domains: ReadonlyArray<{
    id: keyof typeof DOMAIN_ICONS;
    title: string;
    summary: string;
  }>;
  openSourceBoundary: string;
  matrixTitle: string;
  groups: Record<CapabilityGroup, string>;
  capabilityGroupsLabel: string;
  capabilityFiltersLabel: string;
  capabilitySampleSource: string;
  localColumn: string;
  remoteColumn: string;
  costBoundaryTitle: string;
  costBoundaryBody: string;
  trustTitle: string;
  permissions: { title: string; body: string };
  signing: { title: string; body: string; link: string };
  topologyTitle: string;
  topologyStages: ReadonlyArray<{
    id: keyof typeof STAGE_ICONS;
    status: string;
    title: string;
    body: string;
  }>;
}>> = {
  zh: {
    metaTitle: '平台架构 | Nimi',
    metaDescription: '了解 Nimi 的 Runtime、Cognition 和 Realm 如何分工，应用怎样调用多模态 AI、申请权限，以及设备之间如何直连。',
    title: 'Nimi 平台',
    lead: 'Nimi 是可安装的开源个人 AI 平台。在自己的电脑上运行 AI，在授权的应用之间延续伙伴记忆。',
    downloadCta: '下载 Nimi Beta',
    sourceCta: '开源仓库',
    specCta: '平台规范',
    domainsTitle: '平台架构',
    domains: [
      {
        id: 'runtime',
        title: 'Runtime',
        summary: '在你的电脑上调度本地模型和你配置的云端连接器。',
      },
      {
        id: 'cognition',
        title: 'Cognition',
        summary: '在本机保存伙伴的长期记忆。你可以查看来源、修正或删除记忆，各应用的私有数据独立存放。',
      },
      {
        id: 'realm',
        title: 'Realm',
        summary: '托管 Nimi 账号、好友隐私设置与公开世界资料。本地模型与应用数据默认留在设备上。',
      },
    ],
    openSourceBoundary: 'Runtime 和 Cognition 开源。Realm 服务端由 Nimi Network Limited 私有维护。',
    matrixTitle: `${ACTIVE_CAPABILITIES.length} 种 AI 能力`,
    groups: {
      text: '文本',
      visual: '视觉与实时交互',
      audio: '音频',
    },
    capabilityGroupsLabel: '能力类型',
    capabilityFiltersLabel: '选择要查看的能力',
    capabilitySampleSource: 'Nimi Lab 测试记录',
    localColumn: '本地引擎',
    remoteColumn: '云端连接器',
    costBoundaryTitle: '费用与数据去向',
    costBoundaryBody: 'Nimi 免费。使用云端服务时，所需输入与上下文会发送给所选服务商，费用按服务商定价计算。第三方应用由发布者定价。',
    trustTitle: '权限与安全',
    permissions: {
      title: '应用权限',
      body: '应用须声明所需的 AI 能力、MCP 资料源和消息通道。Nimi 会拒绝受管会话中未经授权的调用。',
    },
    signing: {
      title: '安装包校验',
      body: '公开 Beta 的更新清单支持 Ed25519 验签，并记录安装包的 SHA-256 摘要。',
      link: '代码签名与校验政策',
    },
    topologyTitle: '跨设备连接',
    topologyStages: [
      {
        id: 'desktop',
        status: '公开 Beta',
        title: '电脑主 Runtime',
        body: '在 Apple Silicon Mac 或 Windows x86_64 电脑安装 Nimi Beta，然后在桌面端的 Nimi Home 配置模型。原生应用通过经过验证的本机会话使用 Runtime。应用目录和开发者模式的可用性取决于应用、平台和宿主版本。',
      },
      {
        id: 'remote',
        status: '按客户端准入',
        title: '远程直连',
        body: '在官网账号中心管理已绑定的主 Runtime。首次连接需在 Nimi Home 确认，且客户端须能直连主机。Web 和 Android 应用各有独立准入与操作范围。',
      },
      {
        id: 'roadmap',
        status: '长期方向',
        title: '家庭主机与专用设备',
        body: '探索让家庭常驻主机、车载终端和专用硬件使用同一套 AI 能力与记忆。',
      },
    ],
  },
  en: {
    metaTitle: 'Platform Architecture | Nimi',
    metaDescription: 'See how Runtime, Cognition, and Realm fit together, how apps use multimodal AI and request permissions, and how devices connect directly.',
    title: 'Nimi Platform',
    lead: 'Nimi is an open-source AI platform you install on your own computer. Run AI locally and carry companion memory across authorized apps.',
    downloadCta: 'Download Nimi Beta',
    sourceCta: 'Source on GitHub',
    specCta: 'Platform specification',
    domainsTitle: 'Platform architecture',
    domains: [
      {
        id: 'runtime',
        title: 'Runtime',
        summary: 'Routes AI requests from your computer to local models or the cloud connectors you configure.',
      },
      {
        id: 'cognition',
        title: 'Cognition',
        summary: 'Stores long-term companion memory on your device. You can review sources, edit memories, or delete them. Each app keeps its own private storage.',
      },
      {
        id: 'realm',
        title: 'Realm',
        summary: 'Hosts Nimi accounts, friendship privacy settings, and public world data. Local models and app data stay on your device by default.',
      },
    ],
    openSourceBoundary: 'Runtime and Cognition are open source. Nimi Network Limited maintains the Realm backend privately.',
    matrixTitle: `${ACTIVE_CAPABILITIES.length} AI capabilities`,
    groups: {
      text: 'Text & embeddings',
      visual: 'Visual & realtime',
      audio: 'Audio',
    },
    capabilityGroupsLabel: 'Capability types',
    capabilityFiltersLabel: 'Choose a capability to inspect',
    capabilitySampleSource: 'Nimi Lab test record',
    localColumn: 'Local engines',
    remoteColumn: 'Cloud connectors',
    costBoundaryTitle: 'Costs and data',
    costBoundaryBody: 'Nimi is free. When you choose a cloud service, it receives the required inputs and context, and charges according to its own pricing. Third-party publishers set their own app prices.',
    trustTitle: 'Permissions and security',
    permissions: {
      title: 'App permissions',
      body: 'Apps declare the AI capabilities, MCP sources, and messaging channels they need. Nimi rejects unauthorized calls in managed sessions.',
    },
    signing: {
      title: 'Installer verification',
      body: 'Public Beta update manifests support Ed25519 verification and include the installers’ SHA-256 digests.',
      link: 'Code Signing & Verification Policy',
    },
    topologyTitle: 'Connect across devices',
    topologyStages: [
      {
        id: 'desktop',
        status: 'Public Beta',
        title: 'Primary PC Runtime',
        body: 'Install Nimi Beta on an Apple Silicon Mac or Windows x86_64 PC and configure models in Nimi Home on desktop. Native apps use Runtime through verified local sessions. Catalog and Developer Mode availability depends on the app, platform, and host version.',
      },
      {
        id: 'remote',
        status: 'Admitted per client',
        title: 'Direct remote access',
        body: 'Manage your linked primary Runtime in the online account center. First use requires confirmation in Nimi Home and a direct connection to the host. Web and Android apps have separate admission and operation scopes.',
      },
      {
        id: 'roadmap',
        status: 'Long-term direction',
        title: 'Home hubs and dedicated devices',
        body: 'Nimi is exploring how to bring the same capabilities and memory to always-on home hubs, in-vehicle systems, and dedicated hardware.',
      },
    ],
  },
};

export function PlatformPage() {
  const [locale, setLocale] = usePublicPageLocale();
  const [selectedCapability, setSelectedCapability] = useState<CapabilityId>('text.generate');
  const copy = PLATFORM_COPY[locale];
  const capLabels = PLATFORM_CAPABILITY_LABELS[locale];
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
  const selectedItem = capabilityStats.find((item) => item.id === selectedCapability)!;
  const activeGroup = selectedItem.group;
  const groupCapabilities = capabilityStats.filter((item) => item.group === activeGroup);

  const selectGroup = (group: CapabilityGroup) => {
    if (group !== activeGroup) setSelectedCapability(PLATFORM_CAPABILITIES[group][0]);
  };

  return (
    <PublicSiteShell
      locale={locale}
      onLocaleChange={setLocale}
      activePath="/platform"
      shellClassName="public-platform-page"
    >
      <section className="public-hero-section public-platform-hero">
        <div className="story-container public-hero-header public-platform-hero-layout">
          <h1>{copy.title}</h1>
          <div className="public-platform-hero-intro">
            <p className="public-hero-lead">{copy.lead}</p>
            <div className="public-hero-actions">
              <Link to={links.downloadUrl} className="story-button">
                <span>{copy.downloadCta}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <div className="public-platform-reference-links">
                <a href={links.githubUrl} className="story-link">
                  <span>{copy.sourceCta}</span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
                <a href="https://github.com/nimiplatform/nimi/tree/main/.nimi/spec" className="story-link">
                  <span>{copy.specCta}</span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="domains" className="public-page-section" aria-labelledby="domains-heading">
        <div className="story-container">
          <header className="story-heading">
            <h2 id="domains-heading">{copy.domainsTitle}</h2>
          </header>

          <div className="public-domain-grid public-platform-domain-list">
            {copy.domains.map((domain) => {
              const Icon = DOMAIN_ICONS[domain.id];
              return (
                <article key={domain.id} className="public-domain-card" data-domain={domain.id}>
                  <div className="public-platform-card-heading">
                    <span className="story-pillar-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <h3>{domain.title}</h3>
                  </div>
                  <p className="public-domain-summary">{domain.summary}</p>
                </article>
              );
            })}
          </div>

          <p className="public-platform-source-note">{copy.openSourceBoundary}</p>
        </div>
      </section>

      <section id="capabilities" className="public-page-section public-section-tinted public-capabilities-section" aria-labelledby="capabilities-heading">
        <div className="story-container">
          <header className="story-heading story-portals-heading">
            <h2 id="capabilities-heading">{copy.matrixTitle}</h2>
          </header>

          <div className="public-capability-showcase" data-group={activeGroup}>
            <div className="public-capability-group-switch" role="group" aria-label={copy.capabilityGroupsLabel}>
              {CAPABILITY_GROUPS.map((group) => (
                <button
                  key={group}
                  type="button"
                  className={group === activeGroup ? 'is-active' : undefined}
                  data-group={group}
                  aria-pressed={group === activeGroup}
                  aria-controls="platform-capability-sample"
                  onClick={() => selectGroup(group)}
                >
                  <span className="public-capability-group-dot" aria-hidden="true" />
                  <span>{copy.groups[group]}</span>
                </button>
              ))}
            </div>

            <div className="public-capability-stage">
              <section className="public-capability-preview" id="platform-capability-sample" aria-labelledby="capability-sample-heading">
                <PlatformCapabilityPreview
                  key={selectedItem.id}
                  capability={selectedItem.id}
                  locale={locale}
                  title={selectedItem.label}
                  sourceLabel={copy.capabilitySampleSource}
                  headingId="capability-sample-heading"
                  routeCounts={(
                    <div className="public-capability-route-counts">
                      <span><Laptop size={13} aria-hidden="true" /><strong>{selectedItem.localCount}</strong>{copy.localColumn}</span>
                      <span><Globe size={13} aria-hidden="true" /><strong>{selectedItem.remoteCount}</strong>{copy.remoteColumn}</span>
                    </div>
                  )}
                />
              </section>

              <div className="public-capability-browser-footer">
                <div className="public-capability-filter-scroll">
                  <div className="public-capability-filters" role="group" aria-label={copy.capabilityFiltersLabel}>
                    {groupCapabilities.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        data-capability={item.id}
                        className={item.id === selectedCapability ? 'is-active' : undefined}
                        aria-pressed={item.id === selectedCapability}
                        aria-controls="platform-capability-sample"
                        onClick={() => setSelectedCapability(item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Link to={links.downloadUrl} className="public-capability-download">
                  <span>{copy.downloadCta}</span>
                </Link>
              </div>
            </div>
          </div>

          <aside className="public-info-card public-cost-callout" aria-labelledby="cost-boundary-heading">
            <span className="public-cost-callout-icon" aria-hidden="true"><ShieldCheck size={24} /></span>
            <div>
              <h3 id="cost-boundary-heading">{copy.costBoundaryTitle}</h3>
              <p>{copy.costBoundaryBody}</p>
            </div>
          </aside>
        </div>
      </section>

      <section id="trust" className="public-page-section" aria-labelledby="trust-heading">
        <div className="story-container">
          <header className="story-heading story-portals-heading">
            <h2 id="trust-heading">{copy.trustTitle}</h2>
          </header>

          <div className="public-two-column-cards">
            <article className="public-info-card">
              <span className="story-portal-icon" aria-hidden="true">
                <ShieldCheck size={20} />
              </span>
              <h3>{copy.permissions.title}</h3>
              <p>{copy.permissions.body}</p>
            </article>
            <article className="public-info-card">
              <span className="story-portal-icon" aria-hidden="true">
                <ShieldCheck size={20} />
              </span>
              <h3>{copy.signing.title}</h3>
              <p>{copy.signing.body}</p>
              <Link to={withLocaleQuery('/code-signing', locale)} className="story-link">
                <span>{copy.signing.link}</span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </article>
          </div>

          <div className="public-security-workbench-wrap">
            <StoryContentCheck key={locale} t={t} links={links} />
          </div>
        </div>
      </section>

      <section id="topology" className="public-page-section public-section-tinted" aria-labelledby="topology-heading">
        <div className="story-container">
          <header className="story-heading story-portals-heading">
            <h2 id="topology-heading">{copy.topologyTitle}</h2>
          </header>

          <div className="public-domain-grid">
            {copy.topologyStages.map((stage) => {
              const Icon = STAGE_ICONS[stage.id];
              return (
                <article key={stage.id} className="public-domain-card">
                  <div className="public-domain-card-top">
                    <span className="story-pillar-icon story-portal-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <span className={`public-domain-badge story-portal-badge${stage.id === 'desktop' ? ' is-live' : ''}`}>
                      {stage.status}
                    </span>
                  </div>
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

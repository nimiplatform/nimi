import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Code2,
  FileCode2,
  GitFork,
  Package,
  PanelsTopLeft,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { withLocaleQuery } from '../landing/config/landing-links.js';
import { StoryBuilder } from '../landing/components/story/story-builder.js';
import { getStoryCopy, type StoryText } from '../landing/content/story-copy.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import {
  PublicSiteShell,
  usePublicDocumentMetadata,
  useResolvedPublicLinks,
} from './public-site-shell.js';
import { usePublicPageLocale } from './use-page-locale.js';

// @nimi-authority: rule.nimi.platform.core-protocol.p-arch-001a
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-supported-completeness
const DEVELOPERS_COPY: Readonly<Record<LandingLocale, {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  title: string;
  lead: string;
  guideCta: string;
  adaptationsCta: string;
  repoCta: string;
  whyEyebrow: string;
  whyTitle: string;
  whyBody: string;
  whyCards: ReadonlyArray<{
    title: string;
    body: string;
  }>;
  stackEyebrow: string;
  stackTitle: string;
  stackBody: string;
  packages: ReadonlyArray<{
    name: string;
    posture: string;
    license: string;
    description: string;
    href: string;
  }>;
  adaptationBannerTitle: string;
  adaptationBannerBody: string;
  adaptationBannerAction: string;
}>> = {
  zh: {
    metaTitle: '开发者中心与 SDK | Nimi',
    metaDescription: '使用 @nimiplatform/sdk、Vercel AI Adapter、Kit 组件与 App Tools 构建轻量原生应用，或将现有开源项目适配接入 Nimi 底座。',
    eyebrow: '开发者中心 · SDK、组件与开源适配',
    title: '把算力与记忆交给底座，专注构建你的应用体验',
    lead: '无需在安装包里捆绑数 GB 的 Python/CUDA 推理环境，也无需让每位用户单独申请并粘贴 API Key——通过类型化 SDK 接入本地或云端多模态能力与跨应用伙伴上下文。',
    guideCta: '阅读应用开发指南',
    adaptationsCta: '查看 13 款开源适配案例',
    repoCta: 'GitHub 仓库',
    whyEyebrow: '为什么基于 Nimi 构建',
    whyTitle: '既适合从零创建原生应用，也适合适配既有开源项目',
    whyBody: 'Nimi 只接管模型执行、受保护权限与可选的智能体记忆，应用自身的业务状态、工具循环与界面交互完全由开发者掌控。',
    whyCards: [
      {
        title: '告别重复打包推理环境',
        body: '面向 text.generate、audio.transcribe、image.generate 等稳定能力标识调用，由 Nimi Runtime 路由至本机引擎或用户自选云服务。',
      },
      {
        title: '平滑适配现有 AI 应用栈',
        body: '通过 @nimiplatform/sdk-adapter-vercel-ai 保留 AI SDK 7 的 streamText 与自定义工具循环；Vane、SillyTavern、OpenMontage 等开源项目均已完成适配验证。',
      },
      {
        title: '清晰的桌面准入与展示契约',
        body: '使用 App Tools 在本地开发模式调试，通过根目录 NIMI_APP.md 向用户呈现应用说明、所需配置与数据边界。',
      },
    ],
    stackEyebrow: '开发包与协议表面',
    stackTitle: '工具链矩阵与分发状态',
    stackBody: '区分面向本地应用开发的 TypeScript 工具链与仓库内维护的多语言协议绑定源码。',
    packages: [
      {
        name: '@nimiplatform/sdk',
        posture: 'TypeScript 核心 SDK',
        license: 'Apache-2.0',
        description: '类型化多模态 AI 调用、受保护本地会话握手以及 Local Agent / Cognition 记忆读写客户端。',
        href: 'https://github.com/nimiplatform/nimi/tree/main/sdks/typescript',
      },
      {
        name: '@nimiplatform/sdk-adapter-vercel-ai',
        posture: 'Vercel AI SDK 7 适配器',
        license: 'Apache-2.0',
        description: '将 client.ai 桥接为 AI SDK 7 语言模型接口，保留调用方自有的流式输出与工具执行闭环（请与当前 App Tools / Runtime 版本配套使用）。',
        href: 'https://github.com/nimiplatform/nimi/tree/main/sdks/typescript/adapters/vercel-ai',
      },
      {
        name: '@nimiplatform/kit',
        posture: 'UI 组件与 Shell 桥接',
        license: 'Apache-2.0',
        description: '提供共享设计系统原语、标准桌面本地应用桥接层以及智能体记忆中心视图。',
        href: 'https://github.com/nimiplatform/nimi/tree/main/kit',
      },
      {
        name: '@nimiplatform/app-tools',
        posture: '脚手架与本地调试 CLI',
        license: 'Apache-2.0',
        description: '通过 nimi-app create 初始化独立应用工程，校验应用清单、权限声明与 NIMI_APP.md 规范。',
        href: 'https://github.com/nimiplatform/nimi/tree/main/app-tools',
      },
      {
        name: 'sdks/rust · sdks/go · sdks/python',
        posture: '仓库内协议源码绑定',
        license: '仓库源码（Apache-2.0）',
        description: '主仓库 sdks/* 目录下维护的多语言 Runtime / 协议绑定源码，供原生服务与协议集成方直接引用（非独立包管理器分发保证）。',
        href: 'https://github.com/nimiplatform/nimi/tree/main/sdks',
      },
      {
        name: '.nimi/spec',
        posture: '规范权威事实源',
        license: '规范契约',
        description: '覆盖核心协议、能力路由、应用生态准入与安全边界的结构化机器可校验规范。',
        href: 'https://github.com/nimiplatform/nimi/tree/main/.nimi/spec',
      },
    ],
    adaptationBannerTitle: '想把现有的开源 AI 工具迁移到 Nimi？',
    adaptationBannerBody: '先在应用生态页预览 Vane、Next AI Draw.io、OpenMontage、SillyTavern 等开源项目的适配效果，再对照创建指南在本地开发模式启动你的第一个工程。',
    adaptationBannerAction: '浏览应用生态与开源适配',
  },
  en: {
    metaTitle: 'Developers & SDK | Nimi',
    metaDescription: 'Build lightweight native AI apps or adapt open-source projects onto Nimi with @nimiplatform/sdk, Vercel AI Adapter, Kit UI, and App Tools.',
    eyebrow: 'Developers · SDK, UI Kit & Open-Source Adaptation',
    title: 'Delegate compute and memory to the foundation. Build your craft.',
    lead: 'Ship AI apps without bundling multi-gigabyte Python/CUDA runtimes or asking every user to manage per-app API keys—consume local or cloud multimodal capabilities and companion continuity through typed contracts.',
    guideCta: 'Read the App Creation Guide',
    adaptationsCta: 'See 13 Open-Source Adaptations',
    repoCta: 'GitHub Repository',
    whyEyebrow: 'Why Build on Nimi',
    whyTitle: 'Designed for both greenfield apps and existing open-source tools',
    whyBody: 'Nimi governs model execution, protected permissions, and optional companion memory—leaving your app’s UI, domain state, and tool loops completely in your control.',
    whyCards: [
      {
        title: 'Zero bundled inference bloat',
        body: 'Target stable capability IDs like text.generate, audio.transcribe, and image.generate while Nimi Runtime routes to the user’s local engine or chosen cloud connector.',
      },
      {
        title: 'Drop-in Vercel AI SDK 7 adaptation',
        body: 'Keep streamText and caller-owned tool callbacks with @nimiplatform/sdk-adapter-vercel-ai—battle-tested across adaptations like Vane, SillyTavern, and OpenMontage.',
      },
      {
        title: 'Clean local dev & catalog contracts',
        body: 'Scaffold and debug locally with App Tools and Desktop developer mode, and present your app in Nimi Home through a clear root NIMI_APP.md.',
      },
    ],
    stackEyebrow: 'Packages & Protocol Surfaces',
    stackTitle: 'Toolchain matrix & availability posture',
    stackBody: 'A transparent overview of TypeScript Local App packages alongside in-repo protocol bindings and canonical specs.',
    packages: [
      {
        name: '@nimiplatform/sdk',
        posture: 'Core TypeScript SDK',
        license: 'Apache-2.0',
        description: 'Typed multimodal AI invocation, protected local session handshakes, and Local Agent / Cognition memory clients.',
        href: 'https://github.com/nimiplatform/nimi/tree/main/sdks/typescript',
      },
      {
        name: '@nimiplatform/sdk-adapter-vercel-ai',
        posture: 'Vercel AI SDK 7 Adapter',
        license: 'Apache-2.0',
        description: 'Bridges client.ai into AI SDK 7 language model interfaces while preserving caller-owned streaming and tool loops (pair with your matching App Tools / Runtime cohort).',
        href: 'https://github.com/nimiplatform/nimi/tree/main/sdks/typescript/adapters/vercel-ai',
      },
      {
        name: '@nimiplatform/kit',
        posture: 'UI System & Shell Bridge',
        license: 'Apache-2.0',
        description: 'Shared React UI primitives, the standard Local App shell bridge, and inspectable Agent Center memory components.',
        href: 'https://github.com/nimiplatform/nimi/tree/main/kit',
      },
      {
        name: '@nimiplatform/app-tools',
        posture: 'Scaffolding & Dev CLI',
        license: 'Apache-2.0',
        description: 'Initialize standalone app projects with nimi-app create and validate manifests, capability declarations, and NIMI_APP.md.',
        href: 'https://github.com/nimiplatform/nimi/tree/main/app-tools',
      },
      {
        name: 'sdks/rust · sdks/go · sdks/python',
        posture: 'In-Repo Source Bindings',
        license: 'In-repo source (Apache-2.0)',
        description: 'Multi-language Runtime and protocol bindings maintained in the monorepo under sdks/* for native services and protocol consumers (source tree bindings rather than standalone registry guarantees).',
        href: 'https://github.com/nimiplatform/nimi/tree/main/sdks',
      },
      {
        name: '.nimi/spec',
        posture: 'Canonical Authority',
        license: 'Spec contracts',
        description: 'Machine-checked YAML and Markdown specifications defining protocol boundaries, capability routing, and ecosystem admission rules.',
        href: 'https://github.com/nimiplatform/nimi/tree/main/.nimi/spec',
      },
    ],
    adaptationBannerTitle: 'Adapting an existing open-source AI project?',
    adaptationBannerBody: 'Preview how Vane, Next AI Draw.io, OpenMontage, and SillyTavern connect to Nimi on the Apps page, then follow the quickstart guide in local developer mode.',
    adaptationBannerAction: 'Explore Apps & Open-Source Adaptations',
  },
};

export function DevelopersPage() {
  const [locale, setLocale] = usePublicPageLocale();
  const copy = DEVELOPERS_COPY[locale];
  const storyCopy = getStoryCopy(locale);
  const t: StoryText = (key) => storyCopy[key];
  const links = useResolvedPublicLinks(locale);

  usePublicDocumentMetadata(copy.metaTitle, copy.metaDescription, '/developers', locale);

  const whyIcons = [Code2, GitFork, Blocks] as const;
  const pkgIcons = [Code2, Sparkles, PanelsTopLeft, Package, FileCode2, Blocks] as const;

  return (
    <PublicSiteShell locale={locale} onLocaleChange={setLocale} activePath="/developers">
      <section className="public-hero-section">
        <div className="story-container">
          <div className="public-hero-header">
            <span className="public-eyebrow">{copy.eyebrow}</span>
            <h1>{copy.title}</h1>
            <p className="public-hero-lead">{copy.lead}</p>
            <div className="public-hero-actions">
              <a href={links.createGuideUrl} className="story-button">
                <span>{copy.guideCta}</span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
              <Link to={withLocaleQuery('/apps', locale)} className="story-button story-button-outline">
                <span>{copy.adaptationsCta}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a href={links.githubUrl} className="story-link">
                <span>{copy.repoCta}</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="public-feature-grid">
            {copy.whyCards.map((card, index) => {
              const Icon = whyIcons[index] ?? Code2;
              return (
                <article key={card.title} className="public-feature-card">
                  <span className="story-pillar-icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <h2>{card.title}</h2>
                  <p>{card.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <StoryBuilder t={t} links={links} />

      <section id="surfaces" className="public-page-section" aria-labelledby="surfaces-heading">
        <div className="story-container">
          <header className="story-heading">
            <span className="story-eyebrow">{copy.stackEyebrow}</span>
            <h2 id="surfaces-heading">{copy.stackTitle}</h2>
            <p>{copy.stackBody}</p>
          </header>

          <div className="public-domain-grid">
            {copy.packages.map((pkg, index) => {
              const Icon = pkgIcons[index] ?? Package;
              return (
                <article key={pkg.name} className="public-domain-card">
                  <div className="public-domain-card-top">
                    <span className="story-pillar-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <span className="public-domain-badge">{pkg.posture}</span>
                  </div>
                  <h3 className="public-mono-heading">{pkg.name}</h3>
                  <p className="public-domain-summary">{pkg.description}</p>
                  <div className="public-pkg-footer">
                    <small>{pkg.license}</small>
                    <a href={pkg.href} target="_blank" rel="noreferrer" className="public-external-link">
                      <span>GitHub</span>
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  </div>
                </article>
              );
            })}
          </div>

          <aside className="public-info-card public-adaptation-cta">
            <div>
              <h3>{copy.adaptationBannerTitle}</h3>
              <p>{copy.adaptationBannerBody}</p>
            </div>
            <Link to={withLocaleQuery('/apps', locale)} className="story-button">
              <span>{copy.adaptationBannerAction}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </aside>

          <div className="public-two-column-cards public-community-grid">
            <a
              href={links.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="public-info-card public-community-card"
            >
              <div className="public-domain-card-top">
                <span className="story-pillar-icon" aria-hidden="true">
                  <GitFork size={20} />
                </span>
                <span className="public-domain-badge">Apache-2.0 / MIT</span>
              </div>
              <h3>{locale === 'zh' ? 'Nimi 官方开源主仓库' : 'Nimi Open-Source Monorepo'}</h3>
              <p>
                {locale === 'zh'
                  ? '浏览 Runtime、Cognition、Desktop、SDK、Kit、App Tools 与 .nimi/spec 的完整源码，提交 Issue 或参与开源适配贡献。'
                  : 'Inspect the complete source code for Runtime, Cognition, Desktop, SDK, Kit, App Tools, and .nimi/spec—open issues or contribute app adaptations.'}
              </p>
              <span className="story-portal-action">
                <span>github.com/nimiplatform/nimi</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </span>
            </a>

            <a
              href={links.discordUrl}
              target="_blank"
              rel="noreferrer"
              className="public-info-card public-community-card"
            >
              <div className="public-domain-card-top">
                <span className="story-pillar-icon" aria-hidden="true">
                  <Sparkles size={20} />
                </span>
                <span className="public-domain-badge">Discord</span>
              </div>
              <h3>{locale === 'zh' ? '加入开发者与早期用户社区' : 'Join the Developer & Early-Adopter Community'}</h3>
              <p>
                {locale === 'zh'
                  ? '与核心工程团队及其他应用开发者直接交流本地模型调优、开源项目 Nimi 化改造经验与版本路线图。'
                  : 'Connect directly with the core engineering team and fellow builders on local model tuning, open-source Nimi adaptations, and upcoming releases.'}
              </p>
              <span className="story-portal-action">
                <span>{locale === 'zh' ? '前往 Discord 社区' : 'Join Nimi Discord'}</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </span>
            </a>
          </div>
        </div>
      </section>
    </PublicSiteShell>
  );
}

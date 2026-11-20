import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Check,
  Clipboard,
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
import { useCopyCommand } from '../landing/components/use-copy-command.js';
import { getStoryCopy, type StoryText } from '../landing/content/story-copy.js';
import { CREATE_APP_COMMAND } from '../landing/content/story-model.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import {
  PublicSiteShell,
  usePublicDocumentMetadata,
  useResolvedPublicLinks,
} from './public-site-shell.js';
import { usePublicPageLocale } from './use-page-locale.js';

const TOOLCHAIN_PACKAGES = [
  {
    id: 'tools',
    Icon: Package,
    license: 'Apache-2.0',
    command: CREATE_APP_COMMAND,
    href: 'https://github.com/nimiplatform/nimi/tree/main/app-tools',
  },
  {
    id: 'sdk',
    Icon: Code2,
    license: 'Apache-2.0',
    command: 'pnpm add @nimiplatform/sdk',
    href: 'https://github.com/nimiplatform/nimi/tree/main/sdks/typescript',
  },
  {
    id: 'vercel',
    Icon: Sparkles,
    license: 'Apache-2.0',
    command: 'pnpm add @nimiplatform/sdk-adapter-vercel-ai @nimiplatform/sdk "ai@^7" "@ai-sdk/provider@^4"',
    href: 'https://github.com/nimiplatform/nimi/tree/main/sdks/typescript/adapters/vercel-ai',
  },
  {
    id: 'kit',
    Icon: PanelsTopLeft,
    license: 'MIT',
    command: 'pnpm add @nimiplatform/kit @nimiplatform/sdk',
    href: 'https://github.com/nimiplatform/nimi/tree/main/kit',
  },
] as const;

const TOOLCHAIN_REFERENCES = [
  { id: 'bindings', Icon: FileCode2, href: 'https://github.com/nimiplatform/nimi/tree/main/sdks' },
  { id: 'spec', Icon: Blocks, href: 'https://github.com/nimiplatform/nimi/tree/main/.nimi/spec' },
] as const;

type ToolchainPackage = typeof TOOLCHAIN_PACKAGES[number];
type ToolchainPackageCopy = { title: string; description: string };

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
  stackTitle: string;
  stackBody: string;
  sourceAction: string;
  copyAction: string;
  copyError: string;
  packages: Record<ToolchainPackage['id'], ToolchainPackageCopy>;
  references: Record<typeof TOOLCHAIN_REFERENCES[number]['id'], {
    label: string;
    description: string;
  }>;
  adaptationBannerTitle: string;
  adaptationBannerBody: string;
  adaptationBannerAction: string;
}>> = {
  zh: {
    metaTitle: '开发者中心与 SDK | Nimi',
    metaDescription: '使用 @nimiplatform/sdk、Vercel AI Adapter、Kit 组件与 App Tools 构建轻量原生应用，或将现有开源项目适配到 Nimi Runtime。',
    eyebrow: '开发者中心 · SDK、组件与开源适配',
    title: '把模型执行与记忆交给 Nimi，专注构建你的应用体验',
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
    stackTitle: '开发工具链',
    stackBody: '创建应用、接入 Nimi Runtime，或把现有的 AI SDK 项目接到 Nimi。',
    sourceAction: '源码',
    copyAction: '复制命令',
    copyError: '复制失败。请选择命令后手动复制。',
    packages: {
      tools: {
        title: 'App Tools',
        description: '创建独立 Nimi 应用，校验应用清单和权限声明，并在本地调试。',
      },
      sdk: {
        title: 'TypeScript SDK',
        description: '类型化多模态 AI 调用、受保护本地会话握手以及 Local Agent / Cognition 记忆读写客户端。',
      },
      vercel: {
        title: 'Vercel AI SDK 适配器',
        description: '把 Nimi 接入 AI SDK 7，保留现有的流式输出和工具循环。搭配匹配版本的 App Tools 和 Runtime 使用。',
      },
      kit: {
        title: 'Kit',
        description: '复用基于 React 19 的界面组件、桌面应用桥接层和智能体记忆中心视图。',
      },
    },
    references: {
      bindings: {
        label: '浏览协议绑定源码',
        description: '仓库内维护的 Rust、Go 和 Python Runtime 协议绑定。',
      },
      spec: {
        label: '查看平台规范',
        description: '核心协议、能力路由、应用准入与安全边界。',
      },
    },
    adaptationBannerTitle: '想把现有的开源 AI 工具迁移到 Nimi？',
    adaptationBannerBody: '先在应用生态页看看 Vane、Next AI Draw.io、OpenMontage、SillyTavern 等开源项目如何接入 Nimi，再对照创建指南，在本地开发模式下启动你的第一个项目。',
    adaptationBannerAction: '浏览应用生态与开源适配',
  },
  en: {
    metaTitle: 'Developers & SDK | Nimi',
    metaDescription: 'Build lightweight native AI apps or adapt open-source projects for Nimi with @nimiplatform/sdk, Vercel AI SDK Adapter, Kit, and App Tools.',
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
        body: 'Keep streamText and caller-owned tool callbacks with @nimiplatform/sdk-adapter-vercel-ai, battle-tested in adaptations like Vane, SillyTavern, and OpenMontage.',
      },
      {
        title: 'Clean local dev & catalog contracts',
        body: 'Scaffold and debug locally with App Tools and Desktop developer mode, and present your app in Nimi Home through a clear root NIMI_APP.md.',
      },
    ],
    stackTitle: 'Developer toolchain',
    stackBody: 'Create an app, connect to Nimi Runtime, or bring an existing AI SDK project to Nimi.',
    sourceAction: 'Source',
    copyAction: 'Copy command',
    copyError: 'Couldn’t copy the command. Select it and copy it manually.',
    packages: {
      tools: {
        title: 'App Tools',
        description: 'Create a standalone Nimi app, validate its manifest and capabilities, and debug it locally.',
      },
      sdk: {
        title: 'TypeScript SDK',
        description: 'Typed multimodal AI invocation, protected local session handshakes, and Local Agent / Cognition memory clients.',
      },
      vercel: {
        title: 'Vercel AI SDK Adapter',
        description: 'Connect Nimi to AI SDK 7 and keep your existing streaming and tool loops. Use matching App Tools and Runtime versions.',
      },
      kit: {
        title: 'Kit',
        description: 'Reuse React 19 UI components, the desktop app shell bridge, and Agent Center memory views.',
      },
    },
    references: {
      bindings: {
        label: 'Browse protocol bindings',
        description: 'Rust, Go, and Python Runtime protocol bindings maintained in the repository.',
      },
      spec: {
        label: 'Read the platform specification',
        description: 'Core protocol, capability routing, app admission, and security boundaries.',
      },
    },
    adaptationBannerTitle: 'Adapting an existing open-source AI project?',
    adaptationBannerBody: 'Preview how Vane, Next AI Draw.io, OpenMontage, and SillyTavern connect to Nimi on the Apps page, then follow the quickstart guide to run your first project in local developer mode.',
    adaptationBannerAction: 'Explore Apps & Open-Source Adaptations',
  },
};

function ToolchainCard({ pkg, copy, t }: {
  pkg: ToolchainPackage;
  copy: typeof DEVELOPERS_COPY[LandingLocale];
  t: StoryText;
}) {
  const { Icon, href, command, license } = pkg;
  const { title, description } = copy.packages[pkg.id];
  const { copy: copyCommand, copyStatus } = useCopyCommand(command);
  const copyLabel = `${copy.copyAction} · ${title}`;

  return (
    <article className="public-domain-card">
      <span className="story-pillar-icon" aria-hidden="true"><Icon size={20} /></span>
      <h3>{title}</h3>
      <p className="public-domain-summary">{description}</p>
      <div className="public-pkg-footer">
        <small>{license}</small>
        <a href={href} target="_blank" rel="noreferrer" className="public-external-link" aria-label={`${copy.sourceAction} · ${title}`}>
          {copy.sourceAction}
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
      <div className="public-toolchain-command">
        <pre tabIndex={0}><code>{command}</code></pre>
        <button
          type="button"
          onClick={copyCommand}
          aria-label={copyLabel}
          title={copyStatus === 'copied' ? t('builder.copiedCommand') : copyLabel}
        >
          {copyStatus === 'copied' ? <Check size={17} aria-hidden="true" /> : <Clipboard size={17} aria-hidden="true" />}
        </button>
      </div>
      <span role="status" className={copyStatus === 'error' ? 'public-command-copy-error' : 'sr-only'}>
        {copyStatus === 'copied' ? t('builder.copiedCommand') : copyStatus === 'error' ? copy.copyError : ''}
      </span>
    </article>
  );
}

export function DevelopersPage() {
  const [locale, setLocale] = usePublicPageLocale();
  const copy = DEVELOPERS_COPY[locale];
  const storyCopy = getStoryCopy(locale);
  const t: StoryText = (key) => storyCopy[key];
  const links = useResolvedPublicLinks(locale);

  usePublicDocumentMetadata(copy.metaTitle, copy.metaDescription, '/developers', locale);

  const whyIcons = [Code2, GitFork, Blocks] as const;

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
            <h2 id="surfaces-heading">{copy.stackTitle}</h2>
            <p>{copy.stackBody}</p>
          </header>

          <div className="public-toolchain-grid">
            {TOOLCHAIN_PACKAGES.map((pkg) => <ToolchainCard key={pkg.id} pkg={pkg} copy={copy} t={t} />)}
          </div>

          <div className="public-toolchain-references">
            {TOOLCHAIN_REFERENCES.map(({ id, Icon, href }) => {
              const { label, description } = copy.references[id];
              return (
                <a key={id} href={href} target="_blank" rel="noreferrer" className="public-toolchain-reference">
                  <Icon size={19} aria-hidden="true" />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
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

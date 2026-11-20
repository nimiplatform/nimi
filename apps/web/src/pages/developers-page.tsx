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

const TRACK_ICONS: Record<'compute' | 'agent', ReadonlyArray<string>> = {
  compute: [
    '/demo/vane-icon.png',
    '/demo/openmontage-icon.png',
    '/demo/drawio-icon.png',
    '/demo/videolingo-icon.png',
  ],
  agent: [
    '/demo/zhiyu-icon.png',
    '/demo/parentos-icon.png',
    '/demo/storybook-icon.png',
    '/demo/odd-bureau-icon.png',
  ],
};

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
  highlights: ReadonlyArray<string>;
  tracksEyebrow: string;
  tracksTitle: string;
  tracksBody: string;
  tracks: ReadonlyArray<{
    id: 'compute' | 'agent';
    badge: string;
    title: string;
    summary: string;
    specs: ReadonlyArray<{
      label: string;
      code?: string;
      value: string;
    }>;
    examples: string;
  }>;
  lifecycleTitle: string;
  lifecycleSteps: ReadonlyArray<{
    step: string;
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
    metaTitle: '开发者中心：做一款不用打包模型的轻量 AI 软件 | Nimi',
    metaDescription: '几行代码接入 @nimiplatform/sdk、Vercel AI 适配器与 Kit 组件，无需捆绑几 GB 推理环境或索要 API Key。',
    eyebrow: '开发者中心 · 轻装开发 · 快速适配',
    title: '不用塞几个 G 模型，专注做你的好软件',
    lead: '把模型环境、密钥托管和跨应用记忆交给 Nimi——你的安装包轻巧干净，用户装上就能直接用。',
    guideCta: '阅读创建指南',
    adaptationsCta: '看 13 款开源适配案例',
    repoCta: 'GitHub 仓库',
    highlights: [
      '零 Python / CUDA 打包体积负担',
      '一行接入 Vercel AI SDK 7 流式与工具循环',
      '开箱即用 React 19 伙伴记忆组件',
    ],
    tracksEyebrow: '按你的产品形态选路径',
    tracksTitle: '只借用 AI 算力，或深度接入常驻伙伴',
    tracksBody: '现成开源工具几步即可完成改造；原生陪伴与创作应用可直接复用记忆与世界设定。',
    tracks: [
      {
        id: 'compute',
        badge: '路径 A · 借用多模态算力',
        title: '改造现有开源工具 / 独立效率软件',
        summary: '适合搜索、音视频剪辑、画图白板与笔记软件——省掉环境配置与填 Key 门槛。',
        specs: [
          {
            label: '接入方式',
            code: 'sdk-adapter-vercel-ai',
            value: '复用 streamText 与工具调用',
          },
          {
            label: '核心能力',
            value: '文字、生图、视频、语音与音乐等 20 项统一能力',
          },
          {
            label: '数据与状态',
            value: '独立本地目录，界面与状态完全自控',
          },
        ],
        examples: '已适配：Vane · OpenMontage · Next AI Draw.io · VideoLingo · SillyTavern',
      },
      {
        id: 'agent',
        badge: '路径 B · 接入伙伴与世界',
        title: '构建原生陪伴、故事或生活记录应用',
        summary: '适合有声伴侣、互动故事、成长档案与世界创作工坊——共享鲜活角色与记忆。',
        specs: [
          {
            label: '接入方式',
            code: '@nimiplatform/kit',
            value: '嵌入记忆面板与桌面桥接组件',
          },
          {
            label: '核心能力',
            value: '延续伙伴主对话，或仅协办当前任务（不碰私聊）',
          },
          {
            label: '数据与状态',
            value: '按需结合共享世界设定与本地海岛状态',
          },
        ],
        examples: '原生代表：织羽 · ParentOS · Storybook · 奇物局 · World Studio',
      },
    ],
    lifecycleTitle: '四步从本地跑通到开源上架',
    lifecycleSteps: [
      {
        step: '01 · 创建工程',
        title: '一行命令建好模板',
        body: '运行 create-app 生成带类型的独立工程结构。',
      },
      {
        step: '02 · 写清清单',
        title: '声明 nimi.app.yaml 与 NIMI_APP.md',
        body: '列明所需能力权限，并写好给用户看的功能介绍。',
      },
      {
        step: '03 · 实时联调',
        title: '连上桌面端边改边看',
        body: '在桌面开发者模式直接调用本机模型或云接口热更新调试。',
      },
      {
        step: '04 · 开源上架',
        title: '提交公开应用目录',
        body: '开源仓库并提交索引后，用户即可在 Nimi Home 内发现你的软件。',
      },
    ],
    stackTitle: '一键复制安装命令',
    stackBody: '按需挑选脚手架、SDK、AI SDK 7 适配器或界面组件包。',
    sourceAction: '源码',
    copyAction: '复制命令',
    copyError: '复制失败。请选择命令后手动复制。',
    packages: {
      tools: {
        title: 'App Tools',
        description: '一行命令创建新应用、校验权限清单并在本地联调。',
      },
      sdk: {
        title: 'TypeScript SDK',
        description: '调用 20 项全感官 AI 能力、零暴露安全连接器与伙伴记忆接口。',
      },
      vercel: {
        title: 'Vercel AI SDK 适配器',
        description: '把 Nimi 接入 AI SDK 7，保留原有的流式输出与工具调用逻辑。',
      },
      kit: {
        title: 'Kit',
        description: '开箱即用的 React 19 界面组件、桌面桥接与伙伴记忆视图。',
      },
    },
    references: {
      bindings: {
        label: '浏览多语言协议绑定',
        description: '仓库内维护的 Rust、Go 与 Python Runtime 绑定。',
      },
      spec: {
        label: '查阅平台协议规范',
        description: '深入了解能力路由、应用准入与隐私边界定义。',
      },
    },
    adaptationBannerTitle: '想看看现成开源项目接入后长什么样？',
    adaptationBannerBody: '先去应用生态页在线试玩 Vane、Next AI Draw.io、OpenMontage 等改造实例，再动手跑你的第一个工程。',
    adaptationBannerAction: '试玩 23 款已接入应用',
  },
  en: {
    metaTitle: 'Developers: Ship Lightweight AI Apps Without Model Bloat | Nimi',
    metaDescription: 'Build with @nimiplatform/sdk, Vercel AI Adapter, Kit UI, and App Tools—zero bundled model runtimes or per-app API keys.',
    eyebrow: 'Developers · Lightweight Stack · Fast Adaptation',
    title: 'Skip multi-GB model bundles. Just build your app',
    lead: 'Let Nimi handle model runtimes, API keys, and cross-app memory—so your installer stays tiny and works out of the box.',
    guideCta: 'Read Creation Guide',
    adaptationsCta: 'See 13 Open-Source Examples',
    repoCta: 'GitHub Repository',
    highlights: [
      'Zero bundled Python / CUDA runtime bloat',
      'Drop-in Vercel AI SDK 7 streaming & tool loops',
      'Ready-made React 19 companion memory views',
    ],
    tracksEyebrow: 'Pick Your Depth',
    tracksTitle: 'Use AI compute alone, or plug into living companions',
    tracksBody: 'Adapt an existing open-source utility in minutes, or build a native companion app with shared memory.',
    tracks: [
      {
        id: 'compute',
        badge: 'Track A · Shared AI Compute',
        title: 'Adapt open-source tools & focused utilities',
        summary: 'Great for search, media editors, diagramming, and notebooks—no model setup or key prompts.',
        specs: [
          {
            label: 'Integration',
            code: 'sdk-adapter-vercel-ai',
            value: 'keeps streamText & tool loops',
          },
          {
            label: 'Capabilities',
            value: '20 unified APIs across text, image, video, voice & music',
          },
          {
            label: 'Data & State',
            value: 'Isolated local folder; full control over UI and state',
          },
        ],
        examples: 'Adapted examples: Vane · OpenMontage · Next AI Draw.io · VideoLingo · SillyTavern',
      },
      {
        id: 'agent',
        badge: 'Track B · Companions & Worlds',
        title: 'Build voiced companions, stories & journals',
        summary: 'Great for interactive fiction, family journals, and creative studios powered by persistent memory.',
        specs: [
          {
            label: 'Integration',
            code: '@nimiplatform/kit',
            value: 'memory drawers & desktop bridges',
          },
          {
            label: 'Capabilities',
            value: 'Continue shared chats, or run tasks without private DMs',
          },
          {
            label: 'Data & State',
            value: 'Shared world lore and local island state on demand',
          },
        ],
        examples: 'Native examples: Zhiyu · ParentOS · Storybook · Odd Bureau · World Studio',
      },
    ],
    lifecycleTitle: 'Four steps from starter to Desktop Catalog',
    lifecycleSteps: [
      {
        step: '01 · Scaffold',
        title: 'Generate a starter',
        body: 'Run create-app to scaffold a typed standalone project.',
      },
      {
        step: '02 · Declare',
        title: 'Write nimi.app.yaml & NIMI_APP.md',
        body: 'List minimal permissions and add a clear user-facing intro.',
      },
      {
        step: '03 · Live Debug',
        title: 'Hot-reload on desktop',
        body: 'Test live against local GPUs or cloud connectors in Dev Mode.',
      },
      {
        step: '04 · Publish',
        title: 'Share to the catalog',
        body: 'Publish open source and submit to appear inside Nimi Home.',
      },
    ],
    stackTitle: 'Copy & install packages',
    stackBody: 'Pick the CLI, typed SDK, Vercel AI 7 adapter, or React UI kit.',
    sourceAction: 'Source',
    copyAction: 'Copy command',
    copyError: 'Couldn’t copy the command. Select it and copy it manually.',
    packages: {
      tools: {
        title: 'App Tools',
        description: 'Scaffold standalone apps, validate manifests, and debug locally.',
      },
      sdk: {
        title: 'TypeScript SDK',
        description: 'Typed calls across 20 AI capabilities, zero-exposure integrations, and companion memory.',
      },
      vercel: {
        title: 'Vercel AI SDK Adapter',
        description: 'Plug Nimi into AI SDK 7 while keeping your streaming and tool loops.',
      },
      kit: {
        title: 'Kit',
        description: 'Reusable React 19 UI components, desktop bridges, and memory views.',
      },
    },
    references: {
      bindings: {
        label: 'Browse Rust, Go & Python bindings',
        description: 'Protocol bindings maintained inside the monorepo.',
      },
      spec: {
        label: 'Read the platform specification',
        description: 'Detailed protocol, routing, admission, and privacy rules.',
      },
    },
    adaptationBannerTitle: 'Want to see adapted open-source apps in action first?',
    adaptationBannerBody: 'Try Vane, Next AI Draw.io, OpenMontage, and SillyTavern right in your browser on the Apps page.',
    adaptationBannerAction: 'Preview 23 Live Apps',
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
              </a>
              <Link to={withLocaleQuery('/apps', locale)} className="story-button story-button-outline">
                <span>{copy.adaptationsCta}</span>
              </Link>
              <a href={links.githubUrl} className="story-link">
                <span>{copy.repoCta}</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="public-home-highlights-strip public-dev-highlights-strip">
            {copy.highlights.map((label) => (
              <div key={label} className="public-home-highlight-pill">
                <Check size={15} aria-hidden="true" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="tracks" className="public-page-section public-section-tinted" aria-labelledby="tracks-heading">
        <div className="story-container">
          <header className="story-heading public-section-heading-wide">
            <span className="story-eyebrow">{copy.tracksEyebrow}</span>
            <h2 id="tracks-heading">{copy.tracksTitle}</h2>
            <p>{copy.tracksBody}</p>
          </header>

          <div className="public-two-column-cards public-tracks-grid">
            {copy.tracks.map((track) => (
              <article key={track.id} className="public-info-card public-track-card" data-track={track.id}>
                <div className="public-domain-card-top">
                  <div className="public-track-icons" aria-hidden="true">
                    {TRACK_ICONS[track.id].map((src) => (
                      <img key={src} src={src} alt="" width={28} height={28} loading="lazy" decoding="async" />
                    ))}
                  </div>
                  <span className="public-domain-badge">{track.badge}</span>
                </div>
                <h3>{track.title}</h3>
                <p>{track.summary}</p>
                <dl className="public-track-specs">
                  {track.specs.map((spec) => (
                    <div key={spec.label} className="public-track-spec-row">
                      <dt>{spec.label}</dt>
                      <dd>
                        {spec.code ? <code className="public-track-spec-code">{spec.code}</code> : null}
                        <span>{spec.value}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
                <small className="public-track-examples">{track.examples}</small>
              </article>
            ))}
          </div>

          <div className="public-lifecycle-wrap">
            <h3 className="public-lifecycle-heading">{copy.lifecycleTitle}</h3>
            <div className="public-lifecycle-grid">
              {copy.lifecycleSteps.map((item) => (
                <article key={item.step} className="public-routing-card public-lifecycle-card">
                  <span>{item.step}</span>
                  <h4>{item.title}</h4>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <StoryBuilder t={t} links={links} />

      <section id="surfaces" className="public-page-section public-section-tinted" aria-labelledby="surfaces-heading">
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
            <Link to={withLocaleQuery('/apps#apps-catalog', locale)} className="story-button">
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
              <h3>{locale === 'zh' ? 'Nimi 开源主仓库' : 'Nimi Open-Source Monorepo'}</h3>
              <p>
                {locale === 'zh'
                  ? '查看 Runtime、Cognition、Desktop、SDK、Kit 与 App Tools 源代码，提 Issue 或参与社区贡献。'
                  : 'Browse source code across Runtime, Cognition, Desktop, SDK, Kit, and App Tools—open issues or contribute.'}
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
              <h3>{locale === 'zh' ? '加入开发者与玩家社区' : 'Join Builders & Early Users'}</h3>
              <p>
                {locale === 'zh'
                  ? '和工程团队及其他创作者直接交流本地模型心得、开源工具改造经验与新版本动向。'
                  : 'Chat directly with the team and fellow creators about local setups, open-source adaptations, and updates.'}
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

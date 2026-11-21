import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { editorialSlugs } from './catalog-slugs.js';
import { pcTargetLabels, PublicProduct, useHostedDirectory, WebLaunch } from './hosted-directory.js';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  ChevronDown,
  ChevronUp,
  Cpu,
  ExternalLink,
  FolderLock,
  Info,
  Layers3,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import { withLocaleQuery } from '../landing/config/landing-links.js';
import { DemoAppPreview } from '../landing/components/demo-app-preview.js';
import { useHeroDemoSession } from '../landing/components/hero-demo-context.js';
import { HeroDemoSessionProvider } from '../landing/components/hero-demo-session.js';
import { HomeCompanionBento } from '../landing/components/story/home-companion-bento.js';
import { StoryIntegrations } from '../landing/components/story/story-capabilities.js';
import { StoryHome } from '../landing/components/story/story-home.js';
import { StoryWorlds } from '../landing/components/story/story-worlds.js';
import { createCoreHeroDemo } from '../landing/content/core-hero-demo.js';
import type { HeroDemoSurface } from '../landing/content/landing-content.js';
import { getStoryCopy, type StoryText } from '../landing/content/story-copy.js';
import { DEFAULT_STORY_AGENT } from '../landing/content/story-model.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import {
  APP_ECOSYSTEM_COPY,
  getEcosystemApps,
  INITIAL_VISIBLE_APP_COUNT,
  type EcosystemFilterId,
} from './app-ecosystem-data.js';
import { AppsFoundationStage } from './apps-foundation-stage.js';
import { CAPABILITY_LABELS, INFORMATIONAL_CONTENT } from './informational-content.js';
import {
  PublicSiteLink,
  PublicSiteShell,
  usePublicDocumentMetadata,
  useResolvedPublicLinks,
} from './public-site-shell.js';
import { usePublicPageLocale } from './use-page-locale.js';

const DownloadPage = lazy(async () => {
  const module = await import('./release-pages.js');
  return { default: module.DownloadPage };
});
const CodeSigningPolicyPage = lazy(async () => {
  const module = await import('./release-pages.js');
  return { default: module.CodeSigningPolicyPage };
});

export type StaticPageKind = 'home' | 'apps' | 'download' | 'code-signing' | 'privacy' | 'terms';

type InformationalPageKind = Extract<StaticPageKind, 'home' | 'apps'>;

const LEGAL_DOCUMENTS = {
  privacy: {
    href: '/privacy.html',
    title: 'Privacy Policy',
  },
  terms: {
    href: '/terms.html',
    title: 'Terms of Service',
  },
} satisfies Record<Extract<StaticPageKind, 'privacy' | 'terms'>, { href: string; title: string }>;

function isLegalPage(kind: StaticPageKind): kind is keyof typeof LEGAL_DOCUMENTS {
  return kind === 'privacy' || kind === 'terms';
}

function LegalDocumentRedirect({ document }: { document: (typeof LEGAL_DOCUMENTS)[keyof typeof LEGAL_DOCUMENTS] }) {
  useEffect(() => {
    window.location.replace(document.href);
  }, [document.href]);

  return (
    <main className="web-static-page">
      <section>
        <h1>{document.title}</h1>
        <p>Opening the current Nimi {document.title}.</p>
        <a href={document.href}>Continue to {document.title}</a>
      </section>
    </main>
  );
}

const HOME_WORKSPACE_PILLS: Readonly<Record<LandingLocale, ReadonlyArray<{
  Icon: typeof Layers3;
  label: string;
}>>> = {
  zh: [
    { Icon: Cpu, label: 'AI 模型配一次，所有软件直接用' },
    { Icon: Layers3, label: '在 Home 与织羽之间无缝接着聊' },
    { Icon: ShieldCheck, label: '聊天与记忆默认留在你自己电脑上' },
  ],
  en: [
    { Icon: Cpu, label: 'Configure AI once across every app' },
    { Icon: Layers3, label: 'Pick up chats seamlessly across Home & Zhiyu' },
    { Icon: ShieldCheck, label: 'Chats and memory stay on your computer' },
  ],
};

function HomePageInner({
  locale,
  onLocaleChange,
}: {
  locale: LandingLocale;
  onLocaleChange: (locale: LandingLocale) => void;
}) {
  const copy = INFORMATIONAL_CONTENT[locale];
  const storyCopy = getStoryCopy(locale);
  const t: StoryText = (key) => storyCopy[key];
  const session = useHeroDemoSession();
  const [expandedHome, setExpandedHome] = useState(false);

  usePublicDocumentMetadata(`${copy.home.metaTitle} | Nimi`, copy.home.intro, '/home', locale);

  const openHomeSurface = (surface: HeroDemoSurface, target?: string) => {
    session.navigate(surface, target);
    setExpandedHome(true);
  };

  return (
    <PublicSiteShell locale={locale} onLocaleChange={onLocaleChange} activePath="/home">
      <section className="public-hero-section">
        <div className="story-container">
          <div className="public-hero-header">
            <span className="public-eyebrow">
              {locale === 'zh' ? '伙伴与世界 · 声音、记忆与海岛日常' : 'Companions & Worlds · Voice, Memory & Island Life'}
            </span>
            <h1>{copy.home.title}</h1>
            <p className="public-hero-lead">{copy.home.intro}</p>
            <div className="public-hero-actions">
              <PublicSiteLink to={withLocaleQuery('/download', locale)} className="story-button">
                <span>{copy.home.downloadCta}</span>
              </PublicSiteLink>
              <a href="#local-agent" className="story-button story-button-outline">
                <Sparkles size={16} aria-hidden="true" />
                <span>{locale === 'zh' ? '体验海岛日常与记忆开关' : 'Try Island Life & Memory'}</span>
              </a>
              <PublicSiteLink to={withLocaleQuery('/apps', locale)} className="story-link">
                <Blocks size={16} aria-hidden="true" />
                <span>{copy.home.appsCta}</span>
              </PublicSiteLink>
            </div>
          </div>

          <div className="public-home-stage">
            <StoryHome
              t={t}
              expanded={expandedHome}
              onExpanded={setExpandedHome}
              layout="hero"
            />
          </div>

          <div className="public-home-highlights-strip">
            {HOME_WORKSPACE_PILLS[locale].map(({ Icon, label }) => (
              <div key={label} className="public-home-highlight-pill">
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <StoryWorlds
        t={t}
        locale={locale}
        onOpenWorld={(worldId) => openHomeSurface('explore', `world:${worldId}`)}
      />

      <HomeCompanionBento locale={locale} />

      <section id="realm-origin" className="public-page-section public-section-tinted">
        <div className="story-container">
          <header className="story-heading public-section-heading-wide">
            <span className="story-eyebrow">{copy.home.worldsExampleTitle}</span>
            <h2>{copy.home.worldsTitle}</h2>
            <p>{copy.home.worldsBody}</p>
          </header>

          <ol className="public-visual-steps">
            <li className="public-info-card public-visual-step-card">
              <div className="public-visual-step-top">
                <span className="public-step-num">01</span>
                <div className="public-visual-step-avatars" aria-hidden="true">
                  <img src="/demo/explore/emberware-court-character-0.png" alt="" width={34} height={34} />
                  <img src="/demo/explore/meridian-archipelago-character-0.png" alt="" width={34} height={34} />
                  <img src="/demo/explore/d10-character-1.png" alt="" width={34} height={34} />
                </div>
              </div>
              <p>{copy.home.worldsExampleSteps[0]}</p>
            </li>
            <li className="public-info-card public-visual-step-card">
              <div className="public-visual-step-top">
                <span className="public-step-num">02</span>
                <span className="public-visual-step-chip" aria-hidden="true">
                  <FolderLock size={14} />
                  <span>{locale === 'zh' ? '落户本机文件夹' : 'Local Folder'}</span>
                </span>
              </div>
              <p>{copy.home.worldsExampleSteps[1]}</p>
            </li>
            <li className="public-info-card public-visual-step-card">
              <div className="public-visual-step-top">
                <span className="public-step-num">03</span>
                <span className="public-visual-step-chip" aria-hidden="true">
                  <Volume2 size={14} />
                  <span>{locale === 'zh' ? '私聊不外传' : 'Private Forever'}</span>
                </span>
              </div>
              <p>{copy.home.worldsExampleSteps[2]}</p>
            </li>
          </ol>

          <div className="public-info-card public-start-banner">
            <div className="public-start-banner-copy">
              <h3>{copy.home.startTitle}</h3>
              <p>{copy.home.startBody}</p>
            </div>
            <div className="public-hero-actions">
              <PublicSiteLink to={withLocaleQuery('/download', locale)} className="story-button">
                <span>{copy.home.downloadCta}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </PublicSiteLink>
              <PublicSiteLink to={withLocaleQuery('/apps', locale)} className="story-button story-button-outline">
                <span>{copy.home.appsCta}</span>
              </PublicSiteLink>
            </div>
          </div>
        </div>
      </section>
    </PublicSiteShell>
  );
}

export const HOME_PAGE_INITIAL_DEMO: Readonly<{
  surface: HeroDemoSurface;
  target: string;
}> = {
  surface: 'explore',
  target: 'partners',
};

function HomePage() {
  const [locale, setLocale] = usePublicPageLocale();
  const demo = useMemo(() => createCoreHeroDemo(locale), [locale]);

  return (
    <HeroDemoSessionProvider
      key={locale}
      demo={demo}
      initialSurface={HOME_PAGE_INITIAL_DEMO.surface}
      initialTarget={HOME_PAGE_INITIAL_DEMO.target}
    >
      <HomePageInner locale={locale} onLocaleChange={setLocale} />
    </HeroDemoSessionProvider>
  );
}

function AppNotFound({ locale }: { locale: LandingLocale }) {
  const copy = INFORMATIONAL_CONTENT[locale];
  return (
    <section className="story-container public-status-card">
      <h1>{copy.apps.notFoundTitle}</h1>
      <p>{copy.apps.notFoundBody}</p>
      <div className="public-hero-actions">
        <PublicSiteLink to={withLocaleQuery('/apps', locale)} className="story-button">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>{copy.apps.backToApps}</span>
        </PublicSiteLink>
      </div>
    </section>
  );
}

export function resolveAppsDetailDecision(input: {
  slug?: string;
  directoryStatus: 'loading' | 'ok' | 'missing' | 'unavailable';
  liveProduct?: import('./hosted-directory.js').Product;
  selectedEcosystemEntry?: ReturnType<typeof getEcosystemApps>[number];
}): 'list' | 'blocked' | 'live-detail' | 'not-found' | 'editorial' | 'status-placeholder' {
  const { slug, directoryStatus, liveProduct, selectedEcosystemEntry } = input;
  if (!slug) return 'list';
  if (liveProduct?.blocked || liveProduct?.detail_status === 'blocked') return 'blocked';
  const isSpecialNonNative =
    selectedEcosystemEntry?.posture === 'first-party-companion'
    || selectedEcosystemEntry?.posture === 'interactive-preview';
  if (liveProduct && (liveProduct.detail_status === 'published' || liveProduct.detail_status === 'pending')) {
    if (!isSpecialNonNative || liveProduct.detail?.storefront) return 'live-detail';
  }
  if (directoryStatus === 'missing' && !isSpecialNonNative) {
    return 'not-found';
  }
  if (directoryStatus === 'unavailable' && !isSpecialNonNative) {
    return 'status-placeholder';
  }
  if (selectedEcosystemEntry) return 'editorial';
  if (liveProduct) return 'live-detail';
  if (directoryStatus === 'missing' || !/^[a-z0-9-]{1,63}$/u.test(slug)) return 'not-found';
  return 'status-placeholder';
}

export function projectDirectoryApps(
  ecosystemApps: ReturnType<typeof getEcosystemApps>,
  directoryProducts: readonly import('./hosted-directory.js').Product[],
  directoryReady: boolean,
  hasNextPage: boolean,
  locale: LandingLocale,
) {
  const listedProducts = new Map(directoryProducts.map((item) => [item.app_id, item]));
  const mergedApps = ecosystemApps
    .filter((app) => {
      if (directoryReady && !hasNextPage && app.posture === 'catalog-admitted' && !listedProducts.has(app.id)) {
        return false;
      }
      return true;
    })
    .map((app) => {
      const live = listedProducts.get(app.id);
      if (!live) return { ...app, live: undefined };
      const origin = live.origin ?? app.origin;
      const tags = live.has_storefront
        ? (live.tags?.[locale] ?? [])
        : (live.tags?.[locale]?.length ? live.tags[locale] : app.tags);
      const description = (live.has_storefront || live.displayed_version) && live.summary?.[locale]
        ? live.summary[locale]
        : app.description;
      const liveCover = live.cover_urls?.locales?.[locale] ?? live.cover_urls?.default ?? '';
      const previewImageSrc = live.has_storefront ? liveCover : (liveCover || app.previewImageSrc);
      const iconSrc = live.icon_url ?? app.iconSrc;
      return {
        ...app,
        origin,
        tags,
        description,
        previewImageSrc,
        iconSrc,
        live,
      };
    });
  const additionalProducts = directoryProducts.filter((item) => !ecosystemApps.some((app) => app.id === item.app_id));
  return { mergedApps, additionalProducts };
}

function AppsPageInner({
  slug,
  locale,
  onLocaleChange,
}: {
  slug?: string;
  locale: LandingLocale;
  onLocaleChange: (locale: LandingLocale) => void;
}) {
  const copy = INFORMATIONAL_CONTENT[locale];
  const ecosystemCopy = APP_ECOSYSTEM_COPY[locale];
  const labels = CAPABILITY_LABELS[locale];
  const storyCopy = getStoryCopy(locale);
  const t: StoryText = (key) => storyCopy[key];
  const links = useResolvedPublicLinks(locale);
  const session = useHeroDemoSession();

  const ecosystemApps = useMemo(() => getEcosystemApps(locale), [locale]);
  const [activeFilter, setActiveFilter] = useState<EcosystemFilterId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllApps, setShowAllApps] = useState(false);
  const catalogSectionRef = useRef<HTMLElement>(null);

  const directory = useHostedDirectory(slug);
  const liveProduct = slug ? directory.state.products.find((entry) => entry.slug === slug) : undefined;
  const selectedEcosystemEntry = slug ? ecosystemApps.find((entry) => editorialSlugs[entry.id] === slug) : undefined;
  const selectedApp = selectedEcosystemEntry?.catalog;
  const suspended = locale === 'zh' ? '已暂停发行' : 'Distribution suspended';
  const detailDecision = resolveAppsDetailDecision({
    slug,
    directoryStatus: directory.state.status,
    liveProduct,
    selectedEcosystemEntry,
  });

  usePublicDocumentMetadata(
    slug
      ? detailDecision === 'live-detail' || detailDecision === 'blocked'
        ? `${liveProduct?.display_name ?? selectedEcosystemEntry?.name ?? copy.apps.metaTitle} | Nimi`
        : selectedEcosystemEntry && detailDecision === 'editorial'
          ? `${selectedEcosystemEntry.name} | Nimi`
          : `${copy.apps.metaTitle} | Nimi`
      : `${copy.apps.metaTitle} | Nimi`,
    slug
      ? detailDecision === 'live-detail'
        ? liveProduct?.summary[locale] ?? copy.apps.notFoundBody
        : selectedEcosystemEntry && detailDecision === 'editorial'
          ? selectedEcosystemEntry.description
          : copy.apps.notFoundBody
      : copy.apps.intro,
    slug && detailDecision !== 'not-found' ? `/apps/${slug}` : '/apps',
    locale,
  );

  const openInteractivePreview = (appId: string) => {
    session.openPreview(
      appId,
      appId === 'nimi.zhiyu' ? 'companion' : 'home',
      appId === 'nimi.zhiyu' ? DEFAULT_STORY_AGENT : undefined,
    );
  };

  if (detailDecision === 'blocked' && liveProduct) {
    return (
      <PublicSiteShell locale={locale} onLocaleChange={onLocaleChange} activePath="/apps">
        <section className="public-page-section">
          <PublicProduct item={liveProduct} locale={locale} detail />
        </section>
      </PublicSiteShell>
    );
  }

  if (detailDecision === 'live-detail' && liveProduct) {
    return (
      <PublicSiteShell locale={locale} onLocaleChange={onLocaleChange} activePath="/apps">
        <section className="public-page-section">
          <PublicProduct
            item={liveProduct}
            locale={locale}
            detail
            onOpenInteractivePreview={selectedEcosystemEntry ? () => openInteractivePreview(selectedEcosystemEntry.id) : undefined}
            previewActionLabel={selectedEcosystemEntry ? ecosystemCopy.previewAction : undefined}
          />
        </section>
        {selectedEcosystemEntry ? (
          <DemoAppPreview
            opened={session.preview}
            guiding={Boolean(session.preview?.guided)}
            apps={session.demo.apps}
            preview={session.demo.appPreview}
            onClose={session.closePreview}
          />
        ) : null}
      </PublicSiteShell>
    );
  }

  if (detailDecision === 'not-found') {
    return (
      <PublicSiteShell locale={locale} onLocaleChange={onLocaleChange} activePath="/apps">
        <AppNotFound locale={locale} />
      </PublicSiteShell>
    );
  }

  if (detailDecision === 'status-placeholder') {
    return (
      <PublicSiteShell locale={locale} onLocaleChange={onLocaleChange} activePath="/apps">
        <p className="story-container" role="status">
          {directory.state.status === 'unavailable'
            ? (locale === 'zh' ? '暂时无法读取应用目录。' : 'The app directory is unavailable.')
            : (locale === 'zh' ? '正在读取应用介绍…' : 'Loading app details…')}
        </p>
      </PublicSiteShell>
    );
  }

  if (selectedEcosystemEntry) {
    const { id: appId, name: appName, description, origin, posture } = selectedEcosystemEntry;
    const capabilityItems = selectedApp
      ? selectedApp.capabilities.map((capability) => labels[capability] ?? capability)
      : selectedEcosystemEntry.tags;
    const isMonorepoOfficial = origin === 'nimi-official' && !selectedApp;
    const repositoryHref = selectedApp?.repository
      ?? (isMonorepoOfficial
        ? 'https://github.com/nimiplatform/nimi'
        : 'https://github.com/nimiplatform');
    const repositoryLabel = selectedApp
      ? selectedApp.repository.replace('https://github.com/', '')
      : isMonorepoOfficial
        ? 'nimiplatform/nimi'
        : ecosystemCopy.previewSourceNote;
    const licenseLabel = selectedApp?.license
      ?? (posture === 'first-party-companion'
        ? ecosystemCopy.licenseBundledNote
        : isMonorepoOfficial
          ? 'MIT'
          : ecosystemCopy.licensePreviewNote);
    const pcPlatforms = liveProduct && selectedApp
      ? pcTargetLabels(liveProduct.pc_targets)
      : selectedApp?.platforms ?? copy.apps.platforms;
    const platforms = posture === 'interactive-preview' ? [ecosystemCopy.previewPlatformsValue] : [...pcPlatforms];
    if (liveProduct?.web) platforms.push('Web');
    const platformsValue = liveProduct?.blocked ? suspended : platforms.join(' · ') || '—';

    return (
      <PublicSiteShell locale={locale} onLocaleChange={onLocaleChange} activePath="/apps">
        <section className="public-page-section">
          <article className="story-container public-app-detail">
            <PublicSiteLink to={withLocaleQuery('/apps', locale)} className="public-back-link">
              <ArrowLeft size={15} aria-hidden="true" />
              <span>{copy.apps.backToApps}</span>
            </PublicSiteLink>

            <div className="public-app-detail-header">
              <div className="public-app-detail-identity">
                {selectedEcosystemEntry.iconSrc ? (
                  <img
                    src={selectedEcosystemEntry.iconSrc}
                    alt=""
                    width={64}
                    height={64}
                    className="public-app-detail-icon"
                  />
                ) : null}
                <div>
                  <div className="public-app-badges">
                    <span className="public-app-badge" data-origin={origin}>
                      {ecosystemCopy.originBadge[origin]}
                    </span>
                    <span className="public-app-badge is-posture" data-posture={posture}>
                      {liveProduct?.blocked ? suspended : selectedApp
                        ? `${ecosystemCopy.postureBadge[posture]} · ${selectedApp.license}`
                        : ecosystemCopy.postureBadge[posture]}
                    </span>
                  </div>
                  <h1>{appName}</h1>
                </div>
              </div>
              <button
                type="button"
                className="story-button"
                onClick={() => openInteractivePreview(appId)}
              >
                <Play size={15} aria-hidden="true" />
                <span>{ecosystemCopy.previewAction}</span>
              </button>
            </div>

            <p className="public-app-detail-summary">{liveProduct?.summary[locale] ?? description}</p>
            {liveProduct && !liveProduct.blocked && <WebLaunch item={liveProduct} locale={locale} />}
            <p className="public-app-origin-note">{ecosystemCopy.originDetail[origin]}</p>

            <div className="public-app-posture-callout" data-posture={posture}>
              <strong>{ecosystemCopy.availabilityLabel}</strong>
              <p>{liveProduct?.blocked ? (locale === 'zh' ? '当前发行已停用。' : 'Distribution is suspended.') : ecosystemCopy.postureDetail[posture]}</p>
            </div>

            <div className="public-app-detail-preview">
              <button
                type="button"
                className="public-app-detail-preview-button"
                onClick={() => openInteractivePreview(appId)}
                aria-label={`${ecosystemCopy.previewAction} · ${appName}`}
              >
                <img
                  src={selectedEcosystemEntry.previewImageSrc}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span className="story-ownership-preview-pill">
                  <Play size={14} aria-hidden="true" />
                  <span>{ecosystemCopy.previewAction}</span>
                </span>
              </button>
            </div>

            <dl className="public-app-meta-grid">
              <div className="public-app-meta-card">
                <dt>{copy.apps.capabilitiesLabel}</dt>
                <dd className="public-capability-pills">
                  {capabilityItems.length > 0 ? (
                    capabilityItems.map((item) => (
                      <span key={item} className="public-capability-pill">
                        {item}
                      </span>
                    ))
                  ) : (
                    <span>—</span>
                  )}
                </dd>
              </div>
              <div className="public-app-meta-card">
                <dt>{copy.apps.platformsLabel}</dt>
                <dd>{platformsValue}</dd>
              </div>
              <div className="public-app-meta-card">
                <dt>{copy.apps.licenseLabel}</dt>
                <dd>{licenseLabel}</dd>
              </div>
              <div className="public-app-meta-card">
                <dt>{copy.apps.sourceLabel}</dt>
                <dd>
                  <a
                    href={repositoryHref}
                    target="_blank"
                    rel="noreferrer"
                    className="public-external-link"
                  >
                    <span>{repositoryLabel}</span>
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </dd>
              </div>
            </dl>

            {!liveProduct?.blocked && selectedApp && pcPlatforms.length > 0 && (
              <p className="public-availability-note">{copy.apps.statusNote}</p>
            )}
          </article>
        </section>

        <DemoAppPreview
          opened={session.preview}
          guiding={Boolean(session.preview?.guided)}
          apps={session.demo.apps}
          preview={session.demo.appPreview}
          onClose={session.closePreview}
        />
      </PublicSiteShell>
    );
  }

  const { mergedApps, additionalProducts } = projectDirectoryApps(
    ecosystemApps,
    directory.state.products,
    directory.state.status === 'ok',
    Boolean(directory.state.next),
    locale,
  );
  const counts: Record<EcosystemFilterId, number> = {
    all: mergedApps.length + additionalProducts.length,
    'nimi-official': mergedApps.filter((app) => app.origin === 'nimi-official').length
      + additionalProducts.filter((item) => item.origin === 'nimi-official').length,
    'open-source-adapted': mergedApps.filter((app) => app.origin === 'open-source-adapted').length
      + additionalProducts.filter((item) => item.origin === 'open-source-adapted').length,
    community: mergedApps.filter((app) => app.origin === 'community').length
      + additionalProducts.filter((item) => item.origin === 'community').length,
  };
  const postureCounts = {
    'first-party-companion': mergedApps.filter((app) => app.posture === 'first-party-companion').length,
    'catalog-admitted': mergedApps.filter((app) => app.posture === 'catalog-admitted').length + additionalProducts.length,
    'interactive-preview': mergedApps.filter((app) => app.posture === 'interactive-preview').length,
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleProducts = additionalProducts.filter((item) => {
    if (activeFilter !== 'all' && item.origin !== activeFilter) return false;
    if (!normalizedQuery) return true;
    const tagText = (item.tags?.[locale] ?? []).join(' ');
    return `${item.display_name} ${item.summary[locale]} ${tagText} ${item.capabilities.join(' ')} ${item.app_id}`
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const filteredApps = mergedApps.filter((app) => {
    if (activeFilter !== 'all' && app.origin !== activeFilter) return false;
    if (!normalizedQuery) return true;
    const capText = (app.live?.capabilities ?? app.catalog?.capabilities ?? []).join(' ');
    const haystack = `${app.name} ${app.description} ${app.tags.join(' ')} ${capText} ${app.id}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
  const isCollapsible = activeFilter === 'all' && !normalizedQuery && filteredApps.length > INITIAL_VISIBLE_APP_COUNT;
  const isCollapsed = isCollapsible && !showAllApps;
  const visibleApps = isCollapsed ? filteredApps.slice(0, INITIAL_VISIBLE_APP_COUNT) : filteredApps;
  const remainingApps = isCollapsed ? filteredApps.slice(INITIAL_VISIBLE_APP_COUNT) : [];
  const expandPreviewIcons = remainingApps
    .filter((app): app is typeof app & { iconSrc: string } => Boolean(app.iconSrc))
    .slice(0, 4);

  const toggleShowAllApps = () => {
    if (showAllApps) {
      setShowAllApps(false);
      const section = catalogSectionRef.current;
      if (section && typeof window !== 'undefined' && section.getBoundingClientRect().top < 0) {
        section.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
      }
      return;
    }
    setShowAllApps(true);
  };

  return (
    <PublicSiteShell
      locale={locale}
      onLocaleChange={onLocaleChange}
      activePath="/apps"
      shellClassName="public-apps-page"
    >
      <section className="story-hero public-apps-hero" aria-labelledby="apps-page-heading">
        <div className="story-hero-copy public-apps-hero-copy">
          <span className="story-hero-eyebrow">{ecosystemCopy.eyebrow}</span>
          <h1 id="apps-page-heading">{copy.apps.title}</h1>
          <p className="story-hero-lead">{copy.apps.intro}</p>
          <div className="story-hero-actions">
            <a href="#apps-catalog" className="story-button">
              <span>{copy.apps.listTitle}</span>
            </a>
            <a href="#create-your-own" className="story-hero-continue">
              <span>{copy.apps.createTitle}</span>
            </a>
          </div>
          <p className="story-hero-availability">{ecosystemCopy.heroAvailability}</p>
        </div>

        <AppsFoundationStage
          locale={locale}
          apps={ecosystemApps}
          onOpenPreview={openInteractivePreview}
        />
      </section>

      <StoryIntegrations t={t} links={links} />

      <section
        ref={catalogSectionRef}
        id="apps-catalog"
        className="public-page-section public-section-tinted public-apps-catalog"
        aria-labelledby="apps-catalog-heading"
      >
        <div className="story-container">
          <header className="story-heading public-apps-catalog-heading">
            <h2 id="apps-catalog-heading">{copy.apps.listTitle}</h2>
            <p>{ecosystemCopy.previewFootnote}</p>
          </header>

          <div className="public-apps-toolbar">
            <div className="public-filter-pills" role="group" aria-label={ecosystemCopy.filterLabel}>
              {(Object.keys(ecosystemCopy.filters) as EcosystemFilterId[])
                .filter((filterId) => filterId !== 'community' || counts.community > 0)
                .map((filterId) => (
                <button
                  key={filterId}
                  type="button"
                  aria-pressed={activeFilter === filterId}
                  className={activeFilter === filterId ? 'is-active' : undefined}
                  onClick={() => setActiveFilter(filterId)}
                >
                  <span>{ecosystemCopy.filters[filterId]}</span>
                  <small>{counts[filterId]}</small>
                </button>
              ))}
            </div>

            <div className="public-apps-search">
              <Search size={14} aria-hidden="true" className="public-apps-search-icon" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={ecosystemCopy.searchPlaceholder}
                aria-label={ecosystemCopy.searchAriaLabel}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="public-apps-search-clear"
                  aria-label={ecosystemCopy.clearSearch}
                  onClick={() => setSearchQuery('')}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>

          <details className="public-apps-notes-disclosure">
            <summary className="public-apps-notes-summary">
              <span className="public-apps-notes-summary-main">
                <Info size={13.5} aria-hidden="true" />
                <span>{ecosystemCopy.platformsSummary}</span>
              </span>
              <span className="public-apps-notes-summary-toggle">
                <span>{ecosystemCopy.provenanceToggleLabel}</span>
                <ChevronDown size={13.5} aria-hidden="true" />
              </span>
            </summary>

            <div className="public-apps-notes-body" aria-label={ecosystemCopy.provenanceCalloutTitle}>
              <div className="public-provenance-banner">
                <div className="public-provenance-item" data-origin="nimi-official">
                  <span className="public-app-badge" data-origin="nimi-official">
                    {ecosystemCopy.originBadge['nimi-official']} · {counts['nimi-official']}
                  </span>
                  <p>{ecosystemCopy.provenanceCalloutOfficial}</p>
                </div>
                <div className="public-provenance-item" data-origin="open-source-adapted">
                  <span className="public-app-badge" data-origin="open-source-adapted">
                    {ecosystemCopy.originBadge['open-source-adapted']} · {counts['open-source-adapted']}
                  </span>
                  <p>{ecosystemCopy.provenanceCalloutAdapted}</p>
                </div>
              </div>

              <div className="public-posture-breakdown" aria-label={ecosystemCopy.availabilityBreakdownLabel}>
                {ecosystemCopy.availabilityBreakdown.filter((tier) => postureCounts[tier.posture] > 0).map((tier) => (
                  <div key={tier.posture} className="public-posture-tier" data-posture={tier.posture}>
                    <div className="public-posture-tier-head">
                      <span className="public-app-badge is-posture" data-posture={tier.posture}>
                        {tier.title}
                      </span>
                      <strong>{postureCounts[tier.posture]}</strong>
                    </div>
                    <p>{tier.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </details>

          {visibleApps.length > 0 || visibleProducts.length > 0 ? (
            <ul className="public-apps-grid" data-collapsed={isCollapsed ? 'true' : 'false'}>
              {visibleApps.map((app) => {
                const live = app.live;
                const isWindowsOnly = Boolean(
                  app.catalog
                  && app.catalog.platforms.length === 1
                  && app.catalog.platforms[0] === 'Windows x86_64',
                );
                const visibleTags = app.tags.slice(0, 3);

                return (
                  <li
                    key={app.id}
                    className="public-app-card"
                    data-origin={app.origin}
                    data-posture={app.posture}
                  >
                    <PublicSiteLink
                      to={withLocaleQuery(`/apps/${editorialSlugs[app.id]}`, locale)}
                      className="public-app-card-media"
                      aria-label={`${app.name} · ${copy.apps.itemCta}`}
                    >
                      {app.previewImageSrc ? (
                        <img
                          src={app.previewImageSrc}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : app.iconSrc ? (
                        <div className="flex h-full w-full items-center justify-center bg-black/[0.03]">
                          <img src={app.iconSrc} alt="" width={56} height={56} loading="lazy" decoding="async" className="rounded-xl" />
                        </div>
                      ) : null}
                    </PublicSiteLink>

                    <div className="public-app-card-body">
                      <div className="public-app-card-heading">
                        {app.iconSrc ? (
                          <img src={app.iconSrc} alt="" width={40} height={40} loading="lazy" decoding="async" />
                        ) : null}
                        <div className="public-app-card-title-group">
                          <h3>{app.name}</h3>
                          <div className="public-app-card-meta">
                            {live?.blocked && (
                              <span className="public-app-card-meta-note">{suspended}</span>
                            )}
                            <span className="public-app-card-meta-origin" data-origin={app.origin}>
                              {ecosystemCopy.originShortLabel[app.origin]}
                            </span>
                            {app.posture === 'first-party-companion' || app.posture === 'interactive-preview' ? (
                              <span className="public-app-card-meta-note" data-posture={app.posture}>
                                {ecosystemCopy.postureBadge[app.posture]}
                              </span>
                            ) : null}
                            {isWindowsOnly ? (
                              <span className="public-app-card-meta-note is-platform-limit">
                                {ecosystemCopy.windowsOnlyBadge}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <p className="public-app-card-description">{app.description}</p>

                      {visibleTags.length > 0 ? (
                        <div className="public-capability-pills">
                          {visibleTags.map((tag) => (
                            <span key={tag} className="public-capability-pill">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="public-app-card-actions">
                        <button
                          type="button"
                          className="public-app-preview-btn"
                          onClick={() => openInteractivePreview(app.id)}
                        >
                          <Play size={13} aria-hidden="true" />
                          <span>{ecosystemCopy.previewAction}</span>
                        </button>
                        <PublicSiteLink
                          to={withLocaleQuery(`/apps/${editorialSlugs[app.id]}`, locale)}
                          className="public-app-detail-link"
                        >
                          <span>{copy.apps.itemCta}</span>
                          <ArrowRight size={14} aria-hidden="true" />
                        </PublicSiteLink>
                      </div>
                    </div>
                  </li>
                );
              })}
              {visibleProducts.map((item) => (
                <li className="public-app-card" key={item.app_id}>
                  <PublicProduct item={item} locale={locale} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="public-apps-empty" role="status">
              <p className="public-apps-empty-title">{ecosystemCopy.emptySearchTitle}</p>
              <p className="public-apps-empty-body">{ecosystemCopy.emptySearchBody}</p>
              <button
                type="button"
                className="story-button story-button-outline"
                onClick={() => {
                  setActiveFilter('all');
                  setSearchQuery('');
                }}
              >
                {ecosystemCopy.resetFiltersAction}
              </button>
            </div>
          )}

          {directory.state.next && activeFilter === 'all' && (
            <button type="button" className="story-button" onClick={directory.more}>
              {locale === 'zh' ? '更多应用' : 'More apps'}
            </button>
          )}

          {isCollapsible ? (
            <div className="public-apps-expand-bar">
              <button
                type="button"
                className="public-apps-expand-btn"
                data-state={isCollapsed ? 'collapsed' : 'expanded'}
                aria-expanded={!isCollapsed}
                onClick={toggleShowAllApps}
              >
                {isCollapsed ? (
                  <>
                    {expandPreviewIcons.length > 0 ? (
                      <span className="public-apps-expand-icons" aria-hidden="true">
                        {expandPreviewIcons.map((app) => (
                          <img
                            key={app.id}
                            src={app.iconSrc}
                            alt=""
                            width={24}
                            height={24}
                            loading="lazy"
                            decoding="async"
                          />
                        ))}
                      </span>
                    ) : null}
                    <span className="public-apps-expand-label">
                      {ecosystemCopy.expandAllAction.replace('{total}', String(filteredApps.length))}
                    </span>
                    <span className="public-apps-expand-chevron" aria-hidden="true">
                      <ChevronDown size={15} />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="public-apps-expand-label">
                      {ecosystemCopy.collapseAction.replace('{count}', String(INITIAL_VISIBLE_APP_COUNT))}
                    </span>
                    <span className="public-apps-expand-chevron" aria-hidden="true">
                      <ChevronUp size={15} />
                    </span>
                  </>
                )}
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section id="create-your-own" className="public-page-section public-create-section">
        <div className="story-container">
          <div className="public-info-card public-create-card">
            <div className="public-create-copy">
              <h2>{copy.apps.createTitle}</h2>
              <p>{copy.apps.createIntro}</p>
              <p className="public-availability-note">{copy.apps.createCaveat}</p>
              <div className="public-hero-actions">
                <a
                  href={links.createGuideUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="story-button"
                >
                  <span>{copy.apps.guideCta}</span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
                <PublicSiteLink to={withLocaleQuery('/developers', locale)} className="story-button story-button-outline">
                  <span>{locale === 'zh' ? '查看 SDK 与开发者工具' : 'Explore SDK & Developer Tools'}</span>
                  <ArrowRight size={16} aria-hidden="true" />
                </PublicSiteLink>
              </div>
            </div>
            <ol className="public-step-list public-create-steps">
              {copy.apps.createSteps.map((step, index) => (
                <li key={step}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <DemoAppPreview
        opened={session.preview}
        guiding={Boolean(session.preview?.guided)}
        apps={session.demo.apps}
        preview={session.demo.appPreview}
        onClose={session.closePreview}
      />
    </PublicSiteShell>
  );
}

function AppsPage({ slug }: { slug?: string }) {
  const [locale, setLocale] = usePublicPageLocale();
  const demo = useMemo(() => createCoreHeroDemo(locale), [locale]);

  return (
    <HeroDemoSessionProvider key={locale} demo={demo}>
      <AppsPageInner slug={slug} locale={locale} onLocaleChange={setLocale} />
    </HeroDemoSessionProvider>
  );
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005a
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005e
export function StaticPage({ kind }: { kind: StaticPageKind }) {
  if (kind === 'download' || kind === 'code-signing') {
    const Page = kind === 'download' ? DownloadPage : CodeSigningPolicyPage;
    return (
      <Suspense fallback={<main className="web-static-page" aria-busy="true" aria-label="Loading Nimi release information" />}>
        <Page />
      </Suspense>
    );
  }
  if (isLegalPage(kind)) {
    return <LegalDocumentRedirect document={LEGAL_DOCUMENTS[kind]} />;
  }
  return <InformationalPage kind={kind} />;
}

function InformationalPage({ kind }: { kind: InformationalPageKind }) {
  const params = useParams<{ slug?: string }>();
  if (kind === 'home') {
    return <HomePage />;
  }
  return <AppsPage slug={params.slug} />;
}

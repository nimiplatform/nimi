import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Blocks, Cpu, ExternalLink, Layers3, Play, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { withLocaleQuery } from '../landing/config/landing-links.js';
import { DemoAppPreview } from '../landing/components/demo-app-preview.js';
import { useHeroDemoSession } from '../landing/components/hero-demo-context.js';
import { HeroDemoSessionProvider } from '../landing/components/hero-demo-session.js';
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
  type EcosystemFilterId,
} from './app-ecosystem-data.js';
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

const HOME_WORKSPACE_HIGHLIGHTS: Readonly<Record<LandingLocale, ReadonlyArray<{
  Icon: typeof Layers3;
  title: string;
  body: string;
}>>> = {
  zh: [
    {
      Icon: Layers3,
      title: '桌面总控与最近对话',
      body: '在同一工作台启动已安装应用、接着和伙伴对话，并集中查看消息与权限动态。',
    },
    {
      Icon: Cpu,
      title: '本机模型与云服务统一配置',
      body: '管理本机已准备好的模型，或按需填入自有云端凭证，供所有受权应用按模态调用。',
    },
    {
      Icon: ShieldCheck,
      title: '账号身份与本地数据分离',
      body: '浏览器登录用于验证 Nimi 账号与世界生态身份；本机模型、伙伴记忆与 nimi_data 默认留在你的电脑上。',
    },
  ],
  en: [
    {
      Icon: Layers3,
      title: 'Desktop hub & active conversations',
      body: 'Launch installed apps, pick up recent companion chats, and review permissions from a single workspace.',
    },
    {
      Icon: Cpu,
      title: 'One setup for local & cloud AI',
      body: 'Manage local models on your machine or add your own cloud credentials once for authorized apps to share.',
    },
    {
      Icon: ShieldCheck,
      title: 'Account identity separated from local data',
      body: 'Browser sign-in verifies your Nimi identity and world access, while local models, memories, and nimi_data stay on your device.',
    },
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
              {locale === 'zh' ? 'Nimi Home · 桌面主入口与伙伴空间' : 'Nimi Home · Desktop Workspace & Companion Hub'}
            </span>
            <h1>{copy.home.title}</h1>
            <p className="public-hero-lead">{copy.home.intro}</p>
            <div className="public-hero-actions">
              <PublicSiteLink to={withLocaleQuery('/download', locale)} className="story-button">
                <span>{copy.home.downloadCta}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </PublicSiteLink>
              <PublicSiteLink to={withLocaleQuery('/apps', locale)} className="story-button story-button-outline">
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

          <div className="public-feature-grid">
            {HOME_WORKSPACE_HIGHLIGHTS[locale].map(({ Icon, title, body }) => (
              <article key={title} className="public-feature-card">
                <span className="story-pillar-icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <h2>{title}</h2>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <StoryWorlds
        t={t}
        locale={locale}
        onOpenWorld={(worldId) => openHomeSurface('explore', `world:${worldId}`)}
      />

      <section className="public-page-section">
        <div className="story-container public-two-column-cards">
          <article className="public-info-card">
            <h2>{copy.home.worldsTitle}</h2>
            <p>{copy.home.worldsBody}</p>
            <h3 className="public-step-heading">{copy.home.worldsExampleTitle}</h3>
            <ol className="public-step-list">
              {copy.home.worldsExampleSteps.map((step, index) => (
                <li key={step}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </article>

          <article className="public-info-card">
            <h2>{copy.home.startTitle}</h2>
            <p>{copy.home.startBody}</p>
            <div className="public-hero-actions">
              <PublicSiteLink to={withLocaleQuery('/download', locale)} className="story-button">
                <span>{copy.home.downloadCta}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </PublicSiteLink>
              <PublicSiteLink to={withLocaleQuery('/apps', locale)} className="story-button story-button-outline">
                <span>{copy.home.appsCta}</span>
              </PublicSiteLink>
            </div>
            <p className="public-availability-note">{copy.home.availability}</p>
          </article>
        </div>
      </section>
    </PublicSiteShell>
  );
}

function HomePage() {
  const [locale, setLocale] = usePublicPageLocale();
  const demo = useMemo(() => createCoreHeroDemo(locale), [locale]);

  return (
    <HeroDemoSessionProvider key={locale} demo={demo} initialSurface="home">
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

  const selectedEcosystemEntry = slug ? ecosystemApps.find((entry) => entry.id === slug) : undefined;
  const selectedApp = selectedEcosystemEntry?.catalog;

  usePublicDocumentMetadata(
    slug
      ? selectedEcosystemEntry
        ? `${selectedEcosystemEntry.name} | Nimi`
        : `${copy.apps.notFoundTitle} | Nimi`
      : `${copy.apps.metaTitle} | Nimi`,
    slug
      ? selectedEcosystemEntry
        ? selectedEcosystemEntry.description
        : copy.apps.notFoundBody
      : copy.apps.intro,
    slug && selectedEcosystemEntry ? `/apps/${selectedEcosystemEntry.id}` : '/apps',
    locale,
  );

  const openInteractivePreview = (appId: string) => {
    session.openPreview(
      appId,
      appId === 'nimi.zhiyu' ? 'companion' : 'home',
      appId === 'nimi.zhiyu' ? DEFAULT_STORY_AGENT : undefined,
    );
  };

  if (slug && !selectedEcosystemEntry) {
    return (
      <PublicSiteShell locale={locale} onLocaleChange={onLocaleChange} activePath="/apps">
        <AppNotFound locale={locale} />
      </PublicSiteShell>
    );
  }

  if (selectedEcosystemEntry) {
    const { id: appId, name: appName, description, origin, posture } = selectedEcosystemEntry;
    const capabilityItems = selectedApp
      ? selectedApp.capabilities.map((capability) => labels[capability] ?? capability)
      : selectedEcosystemEntry.tags;
    const repositoryHref = selectedApp?.repository
      ?? (posture === 'first-party-companion'
        ? 'https://github.com/nimiplatform/nimi'
        : 'https://github.com/nimiplatform');
    const repositoryLabel = selectedApp
      ? selectedApp.repository.replace('https://github.com/', '')
      : posture === 'first-party-companion'
        ? 'nimiplatform/nimi'
        : ecosystemCopy.previewSourceNote;
    const licenseLabel = selectedApp?.license
      ?? (posture === 'first-party-companion'
        ? ecosystemCopy.licenseBundledNote
        : ecosystemCopy.licensePreviewNote);
    const platformsValue = posture === 'interactive-preview'
      ? ecosystemCopy.previewPlatformsValue
      : (selectedApp?.platforms ?? copy.apps.platforms).join(' · ');

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
                      {selectedApp
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

            <p className="public-app-detail-summary">{description}</p>
            <p className="public-app-origin-note">{ecosystemCopy.originDetail[origin]}</p>

            <div className="public-app-posture-callout" data-posture={posture}>
              <strong>{ecosystemCopy.availabilityLabel}</strong>
              <p>{ecosystemCopy.postureDetail[posture]}</p>
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

            <p className="public-availability-note">{copy.apps.statusNote}</p>
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

  const counts: Record<EcosystemFilterId, number> = {
    all: ecosystemApps.length,
    'nimi-official': ecosystemApps.filter((app) => app.origin === 'nimi-official').length,
    'open-source-adapted': ecosystemApps.filter((app) => app.origin === 'open-source-adapted').length,
    'catalog-admitted': ecosystemApps.filter((app) => app.posture === 'catalog-admitted').length,
  };
  const postureCounts = {
    'first-party-companion': ecosystemApps.filter((app) => app.posture === 'first-party-companion').length,
    'catalog-admitted': counts['catalog-admitted'],
    'interactive-preview': ecosystemApps.filter((app) => app.posture === 'interactive-preview').length,
  };

  const filteredApps = ecosystemApps.filter((app) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'catalog-admitted') return app.posture === 'catalog-admitted';
    return app.origin === activeFilter;
  });

  return (
    <PublicSiteShell locale={locale} onLocaleChange={onLocaleChange} activePath="/apps">
      <section className="public-hero-section">
        <div className="story-container">
          <div className="public-hero-header">
            <span className="public-eyebrow">{ecosystemCopy.eyebrow}</span>
            <h1>{copy.apps.title}</h1>
            <p className="public-hero-lead">{copy.apps.intro}</p>
            <p className="public-availability-note">{copy.apps.statusNote}</p>
          </div>

          <div className="public-provenance-banner" aria-label={ecosystemCopy.provenanceCalloutTitle}>
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
      </section>

      <section className="public-page-section" aria-labelledby="apps-catalog-heading">
        <div className="story-container">
          <div className="public-apps-toolbar">
            <div>
              <h2 id="apps-catalog-heading">{copy.apps.listTitle}</h2>
              <p className="public-apps-subnote">{ecosystemCopy.platformsSummary} · {ecosystemCopy.previewFootnote}</p>
            </div>
            <div className="public-filter-pills" role="group" aria-label={ecosystemCopy.filterLabel}>
              {(Object.keys(ecosystemCopy.filters) as EcosystemFilterId[]).map((filterId) => (
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
          </div>

          <ul className="public-apps-grid">
            {filteredApps.map((app) => (
              <li key={app.id} className="public-app-card" data-origin={app.origin}>
                <button
                  type="button"
                  className="public-app-card-media"
                  onClick={() => openInteractivePreview(app.id)}
                  aria-label={`${ecosystemCopy.previewAction} · ${app.name}`}
                >
                  <img
                    src={app.previewImageSrc}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="public-app-card-play">
                    <Play size={13} aria-hidden="true" />
                    <span>{ecosystemCopy.previewAction}</span>
                  </span>
                </button>

                <div className="public-app-card-body">
                  <div className="public-app-badges">
                    <span className="public-app-badge" data-origin={app.origin}>
                      {ecosystemCopy.originBadge[app.origin]}
                    </span>
                    <span className="public-app-badge is-posture" data-posture={app.posture}>
                      {app.catalog
                        ? `${ecosystemCopy.postureBadge[app.posture]} · ${app.catalog.license}`
                        : ecosystemCopy.postureBadge[app.posture]}
                    </span>
                  </div>

                  <div className="public-app-card-heading">
                    {app.iconSrc ? (
                      <img src={app.iconSrc} alt="" width={40} height={40} loading="lazy" decoding="async" />
                    ) : null}
                    <h3>{app.name}</h3>
                  </div>

                  <p className="public-app-card-description">{app.description}</p>

                  {app.tags.length > 0 ? (
                    <div className="public-capability-pills">
                      {app.tags.map((tag) => (
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
                      to={withLocaleQuery(`/apps/${app.id}`, locale)}
                      className="public-app-detail-link"
                    >
                      <span>{copy.apps.itemCta}</span>
                      <ArrowRight size={14} aria-hidden="true" />
                    </PublicSiteLink>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <StoryIntegrations t={t} links={links} />

      <section id="create-your-own" className="public-page-section">
        <div className="story-container">
          <div className="public-info-card public-create-card">
            <h2>{copy.apps.createTitle}</h2>
            <p>{copy.apps.createIntro}</p>
            <ol className="public-step-list">
              {copy.apps.createSteps.map((step, index) => (
                <li key={step}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
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

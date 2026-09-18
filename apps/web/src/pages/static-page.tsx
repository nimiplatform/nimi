import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { landingLinkDefaults, resolveLocalizedLinks, withLocaleQuery } from '../landing/config/landing-links.js';
import { LanguageToggle } from '../landing/components/language-toggle.js';
import { useHashScroll } from '../landing/hooks/use-hash-scroll.js';
import { APP_CATALOG, CAPABILITY_LABELS, INFORMATIONAL_CONTENT } from './informational-content.js';
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

function useDocumentMetadata(title: string, description: string, path: string) {
  useEffect(() => {
    document.title = title;
    const canonical = `https://nimi.ai${path}`;
    const targets = [
      ['meta[name="description"]', description],
      ['meta[property="og:title"]', title],
      ['meta[property="og:description"]', description],
      ['meta[property="og:url"]', canonical],
      ['meta[name="twitter:title"]', title],
      ['meta[name="twitter:description"]', description],
      ['link[rel="canonical"]', canonical],
    ] as const;
    targets.forEach(([selector, value]) => {
      const element = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
      if (element instanceof HTMLMetaElement) element.content = value;
      else element?.setAttribute('href', value);
    });
  }, [title, description, path]);
}

function InformationalShell({
  locale,
  onLocaleChange,
  children,
}: {
  locale: 'en' | 'zh';
  onLocaleChange: (locale: 'en' | 'zh') => void;
  children: ReactNode;
}) {
  const copy = INFORMATIONAL_CONTENT[locale];
  useHashScroll(true);

  return (
    <div
      className="min-h-screen bg-[#f8fafc] text-slate-900"
      // See landing App.tsx: suppress native drag of selected text, which
      // hangs software-rendered environments. Selection and copy are intact.
      onDragStart={(event) => event.preventDefault()}
    >
      <a href="#main-content" className="skip-link">
        {copy.shared.skipToContent}
      </a>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="container-nimi flex flex-wrap items-center gap-3 py-3">
          <Link
            to={withLocaleQuery('/', locale)}
            className="font-heading text-lg font-semibold tracking-tight text-slate-900 transition hover:text-[#2ba980]"
          >
            Nimi
          </Link>
          <nav aria-label="Nimi site" className="ml-auto hidden items-center gap-4 text-sm font-semibold text-slate-600 sm:flex">
            <Link to={withLocaleQuery('/home', locale)} className="transition hover:text-slate-900">{copy.shared.navHome}</Link>
            <Link to={withLocaleQuery('/apps', locale)} className="transition hover:text-slate-900">{copy.shared.navApps}</Link>
            <a href={withLocaleQuery('/download', locale)} className="transition hover:text-slate-900">{copy.shared.navDownload}</a>
            <a href={withLocaleQuery('/code-signing', locale)} className="transition hover:text-slate-900">{copy.shared.navCodeSigning}</a>
          </nav>
          <LanguageToggle
            locale={locale}
            label={copy.shared.language}
            options={{
              en: 'English',
              zh: '中文',
              switchToEn: copy.shared.switchEnglish,
              switchToZh: copy.shared.switchChinese,
            }}
            onChange={onLocaleChange}
          />
        </div>
      </header>
      <main id="main-content" className="container-nimi py-12 md:py-16">
        {children}
      </main>
    </div>
  );
}

function HomePage() {
  const [locale, setLocale] = usePublicPageLocale();
  const copy = INFORMATIONAL_CONTENT[locale];
  useDocumentMetadata(`${copy.home.metaTitle} | Nimi`, copy.home.intro, '/home');

  return (
    <InformationalShell locale={locale} onLocaleChange={setLocale}>
      <div className="max-w-3xl">
        <h1 className="text-balance font-heading text-4xl font-semibold tracking-tight text-slate-900 md:text-5xl">
          {copy.home.title}
        </h1>
        <p className="mt-5 text-base leading-8 text-slate-600">{copy.home.intro}</p>
      </div>

      <section id="worlds" className="mt-12 max-w-3xl scroll-mt-24 rounded-[1.5rem] border border-slate-200 bg-white p-7">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{copy.home.worldsTitle}</h2>
        <p className="mt-3 text-base leading-7 text-slate-600">{copy.home.worldsBody}</p>
        <h3 className="mt-6 text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
          {copy.home.worldsExampleTitle}
        </h3>
        <ol className="mt-4 space-y-3">
          {copy.home.worldsExampleSteps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-6 text-slate-600">
              <span className="font-bold text-[#2ba980]">{String(index + 1).padStart(2, '0')}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6 max-w-3xl rounded-[1.5rem] border border-slate-200 bg-white p-7">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{copy.home.startTitle}</h2>
        <p className="mt-3 text-base leading-7 text-slate-600">{copy.home.startBody}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={withLocaleQuery('/download', locale)}
            className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-[#0f766e] to-[#0369a1] px-6 py-3 text-sm font-bold text-white"
          >
            {copy.home.downloadCta}
          </a>
          <Link
            to={withLocaleQuery('/apps', locale)}
            className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-700 transition hover:border-emerald-300"
          >
            {copy.home.appsCta}
          </Link>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-500">{copy.home.availability}</p>
      </section>
    </InformationalShell>
  );
}

function AppNotFound({ locale }: { locale: 'en' | 'zh' }) {
  const copy = INFORMATIONAL_CONTENT[locale];
  return (
    <div className="max-w-2xl">
      <h1 className="font-heading text-3xl font-semibold tracking-tight text-slate-900">
        {copy.apps.notFoundTitle}
      </h1>
      <p className="mt-4 text-base leading-7 text-slate-600">{copy.apps.notFoundBody}</p>
      <Link
        to={withLocaleQuery('/apps', locale)}
        className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-bold text-white transition hover:bg-[#2ba980]"
      >
        {copy.apps.backToApps}
      </Link>
    </div>
  );
}

function AppsPage({ slug }: { slug?: string }) {
  const [locale, setLocale] = usePublicPageLocale();
  const copy = INFORMATIONAL_CONTENT[locale];
  const labels = CAPABILITY_LABELS[locale];
  const guideUrl = resolveLocalizedLinks(landingLinkDefaults, locale).createGuideUrl;

  const selectedApp = slug ? APP_CATALOG.find((app) => app.id === slug) : undefined;

  useDocumentMetadata(
    slug
      ? selectedApp
        ? `${selectedApp.name} | Nimi`
        : `${copy.apps.notFoundTitle} | Nimi`
      : `${copy.apps.metaTitle} | Nimi`,
    slug
      ? selectedApp
        ? selectedApp.summary?.[locale] ?? copy.apps.summaryFallback
        : copy.apps.notFoundBody
      : copy.apps.intro,
    slug && selectedApp ? `/apps/${selectedApp.id}` : '/apps',
  );

  if (slug && !selectedApp) {
    return (
      <InformationalShell locale={locale} onLocaleChange={setLocale}>
        <AppNotFound locale={locale} />
      </InformationalShell>
    );
  }

  if (selectedApp) {
    const summary = selectedApp.summary?.[locale] ?? copy.apps.summaryFallback;
    return (
      <InformationalShell locale={locale} onLocaleChange={setLocale}>
        <article className="max-w-3xl">
          <Link to={withLocaleQuery('/apps', locale)} className="text-sm font-semibold text-[#2ba980] transition hover:text-[#1f8a68]">
            ← {copy.apps.backToApps}
          </Link>
          <h1 className="mt-4 font-heading text-4xl font-semibold tracking-tight text-slate-900">
            {selectedApp.name}
          </h1>
          <p className="mt-4 text-base leading-8 text-slate-600">{summary}</p>

          <dl className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[1.25rem] border border-slate-200 bg-white p-5">
              <dt className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                {copy.apps.capabilitiesLabel}
              </dt>
              <dd className="mt-3 flex flex-wrap gap-2">
                {selectedApp.capabilities.length > 0 ? (
                  selectedApp.capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                    >
                      {labels[capability] ?? capability}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">—</span>
                )}
              </dd>
            </div>
            <div className="rounded-[1.25rem] border border-slate-200 bg-white p-5">
              <dt className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                {copy.apps.platformsLabel}
              </dt>
              <dd className="mt-3 text-sm leading-6 text-slate-600">
                {copy.apps.platforms.join(' · ')}
              </dd>
            </div>
            <div className="rounded-[1.25rem] border border-slate-200 bg-white p-5">
              <dt className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                {copy.apps.licenseLabel}
              </dt>
              <dd className="mt-3 text-sm text-slate-600">{selectedApp.license}</dd>
            </div>
            <div className="rounded-[1.25rem] border border-slate-200 bg-white p-5">
              <dt className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                {copy.apps.sourceLabel}
              </dt>
              <dd className="mt-3 text-sm">
                <a
                  className="font-semibold text-[#2ba980] transition hover:text-[#1f8a68]"
                  href={selectedApp.repository}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selectedApp.repository.replace('https://github.com/', '')}
                </a>
              </dd>
            </div>
          </dl>

          <p className="mt-6 text-sm leading-6 text-slate-500">{copy.apps.statusNote}</p>
        </article>
      </InformationalShell>
    );
  }

  return (
    <InformationalShell locale={locale} onLocaleChange={setLocale}>
      <div className="max-w-3xl">
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-slate-900 md:text-5xl">
          {copy.apps.title}
        </h1>
        <p className="mt-5 text-base leading-8 text-slate-600">{copy.apps.intro}</p>
        <p className="mt-4 text-sm leading-6 text-slate-500">{copy.apps.statusNote}</p>
      </div>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{copy.apps.listTitle}</h2>
        <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {APP_CATALOG.map((app) => (
            <li key={app.id} className="flex flex-col rounded-[1.35rem] border border-slate-200 bg-white p-6">
              <h3 className="text-lg font-semibold tracking-tight text-slate-900">{app.name}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
                {app.summary?.[locale] ?? copy.apps.summaryFallback}
              </p>
              <Link
                to={withLocaleQuery(`/apps/${app.id}`, locale)}
                className="mt-4 text-sm font-semibold text-[#2ba980] transition hover:text-[#1f8a68]"
              >
                {copy.apps.itemCta}
                <span aria-hidden="true"> →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="create-your-own"
        className="mt-12 max-w-3xl scroll-mt-24 rounded-[1.5rem] border border-slate-200 bg-white p-7"
      >
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{copy.apps.createTitle}</h2>
        <p className="mt-3 text-base leading-7 text-slate-600">{copy.apps.createIntro}</p>
        <ol className="mt-6 space-y-3">
          {copy.apps.createSteps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-6 text-slate-600">
              <span className="font-bold text-[#2ba980]">{String(index + 1).padStart(2, '0')}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-sm leading-6 text-slate-500">{copy.apps.createCaveat}</p>
        <a
          href={guideUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-gradient-to-r from-[#0f766e] to-[#0369a1] px-6 py-3 text-sm font-bold text-white"
        >
          {copy.apps.guideCta}
        </a>
      </section>
    </InformationalShell>
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

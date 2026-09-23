import { useEffect, useMemo, useRef, useState } from 'react';
import { AppsSection } from './components/apps-section.js';
import { CapabilitiesSection } from './components/capabilities-section.js';
import { ContinuitySection } from './components/continuity-section.js';
import { CreateSection } from './components/create-section.js';
import { DevelopersSection } from './components/developers-section.js';
import { GetStartedSection } from './components/get-started-section.js';
import { HeroSection } from './components/hero-section.js';
import { LanguageToggle } from './components/language-toggle.js';
import { WorldsSection } from './components/worlds-section.js';
import { loadLandingContent, type LandingContent } from './content/landing-content.js';
import { resolveLandingLinks, resolveLocalizedLinks } from './config/landing-links.js';
import { useSectionPaging } from './hooks/use-section-paging.js';
import { useHeroAppsMorph } from './hooks/use-hero-apps-morph.js';
import {
  applyLocaleToLocation,
  persistLocale,
  resolveInitialLocale,
  type LandingLocale,
  type StorageLike,
} from './i18n/locale.js';

function getBrowserStorage(): StorageLike | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}

function getBrowserLanguage(): string {
  if (typeof navigator === 'undefined') {
    return 'en';
  }
  return navigator.language;
}

function getBrowserSearch(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location.search;
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5">
      <path d="M19.54 5.34a16.4 16.4 0 0 0-4.06-1.27.06.06 0 0 0-.06.03c-.18.33-.38.77-.52 1.12a15.3 15.3 0 0 0-4.6 0c-.14-.36-.35-.79-.53-1.12a.06.06 0 0 0-.06-.03A16.36 16.36 0 0 0 5.65 5.34a.05.05 0 0 0-.02.02C3.05 9.2 2.35 12.95 2.7 16.66a.06.06 0 0 0 .02.04 16.5 16.5 0 0 0 4.99 2.52.06.06 0 0 0 .07-.02c.39-.53.73-1.09 1.03-1.68a.06.06 0 0 0-.03-.08 10.75 10.75 0 0 1-1.57-.75.06.06 0 0 1-.01-.1c.1-.08.2-.17.3-.25a.06.06 0 0 1 .06-.01c3.29 1.5 6.85 1.5 10.1 0a.06.06 0 0 1 .06.01l.3.25a.06.06 0 0 1-.01.1c-.5.3-1.03.55-1.57.75a.06.06 0 0 0-.03.08c.31.59.65 1.15 1.03 1.68a.06.06 0 0 0 .07.02 16.44 16.44 0 0 0 5-2.52.06.06 0 0 0 .02-.04c.42-4.29-.7-8-2.94-11.3a.05.05 0 0 0-.02-.02ZM9.75 14.39c-.99 0-1.8-.91-1.8-2.03s.8-2.03 1.8-2.03c1 0 1.82.92 1.8 2.03 0 1.12-.8 2.03-1.8 2.03Zm4.5 0c-.99 0-1.8-.91-1.8-2.03s.8-2.03 1.8-2.03c1 0 1.82.92 1.8 2.03 0 1.12-.8 2.03-1.8 2.03Z" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.57.1.78-.24.78-.54 0-.26-.01-.97-.01-1.9-3.2.7-3.88-1.54-3.88-1.54-.53-1.32-1.28-1.67-1.28-1.67-1.05-.72.08-.7.08-.7 1.16.08 1.78 1.2 1.78 1.2 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.26-1.28-5.26-5.72 0-1.26.45-2.3 1.19-3.1-.12-.3-.52-1.5.11-3.14 0 0 .98-.32 3.2 1.18a11.07 11.07 0 0 1 5.82 0c2.22-1.5 3.2-1.18 3.2-1.18.63 1.64.23 2.84.11 3.14.74.8 1.19 1.84 1.19 3.1 0 4.45-2.7 5.42-5.28 5.7.42.37.78 1.08.78 2.17 0 1.57-.01 2.83-.01 3.22 0 .3.2.65.79.54A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

const ERROR_COPY: Record<LandingLocale, { title: string; description: string; retry: string }> = {
  zh: {
    title: '页面内容加载失败。',
    description: '可以重试加载；如果仍然失败，可以先查看下载页或文档。',
    retry: '重新加载',
  },
  en: {
    title: 'The page content failed to load.',
    description: 'Try loading it again. If it still fails, you can check the download page or the docs.',
    retry: 'Retry',
  },
};

export function App() {
  const baseLinks = useMemo(() => resolveLandingLinks({
    VITE_LANDING_APP_URL: import.meta.env.VITE_LANDING_APP_URL,
    VITE_LANDING_WEB_APP_URL: import.meta.env.VITE_LANDING_WEB_APP_URL,
    VITE_LANDING_DISCORD_URL: import.meta.env.VITE_LANDING_DISCORD_URL,
    VITE_LANDING_DOCS_URL: import.meta.env.VITE_LANDING_DOCS_URL,
    VITE_LANDING_GITHUB_URL: import.meta.env.VITE_LANDING_GITHUB_URL,
    VITE_LANDING_DOCS_SOURCE_URL: import.meta.env.VITE_LANDING_DOCS_SOURCE_URL,
    VITE_LANDING_PROTOCOL_URL: import.meta.env.VITE_LANDING_PROTOCOL_URL,
    VITE_LANDING_DESKTOP_DOWNLOAD_URL: import.meta.env.VITE_LANDING_DESKTOP_DOWNLOAD_URL,
    VITE_LANDING_MODELS_URL: import.meta.env.VITE_LANDING_MODELS_URL,
  }), []);
  const [locale, setLocale] = useState<LandingLocale>(() =>
    resolveInitialLocale({
      storage: getBrowserStorage(),
      search: getBrowserSearch(),
      navigatorLanguage: getBrowserLanguage(),
      defaultLocale: import.meta.env.VITE_LANDING_DEFAULT_LOCALE,
    }),
  );
  // Apply locale prefix (zh -> /zh/) to docs URLs for the docs.nimi.ai subdomain.
  const links = useMemo(() => resolveLocalizedLinks(baseLinks, locale), [baseLinks, locale]);
  const [content, setContent] = useState<LandingContent | null>(null);
  const [contentFailed, setContentFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const heroAppsMorph = useHeroAppsMorph();
  useSectionPaging(Boolean(content), { onFlip: heroAppsMorph.handleFlip, onNavigate: heroAppsMorph.cancel });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const onScroll = () => {
      setScrolled(window.scrollY > 12);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setContentFailed(false);

    void loadLandingContent(locale)
      .then((nextContent) => {
        if (!cancelled) {
          setContent(nextContent);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContentFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      const isZh = locale === 'zh';
      const title = isZh ? 'Nimi｜你的 AI，由你定义。' : 'Nimi | Your AI, Your way.';
      const description = isZh
        ? 'Nimi 是一款开源、本地优先的个人 AI 软件。与你的 AI 交流，用应用写作、研究和创作，让熟悉你的 AI 跨越应用与世界，延续记忆与陪伴。'
        : 'Nimi is an open-source, local-first home for your AI. Talk, write, research, and create with AI that gets to know you—and stays with you across apps and worlds.';
      document.title = title;
      const metadata = [
        ['meta[name="description"]', description],
        ['meta[property="og:title"]', title],
        ['meta[property="og:description"]', description],
        ['meta[property="og:url"]', 'https://nimi.ai'],
        ['meta[name="twitter:title"]', title],
        ['meta[name="twitter:description"]', description],
        ['link[rel="canonical"]', 'https://nimi.ai'],
      ] as const;
      metadata.forEach(([selector, value]) => {
        const element = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
        if (element instanceof HTMLMetaElement) element.content = value;
        else element?.setAttribute('href', value);
      });
    }
  }, [locale]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  if (!content) {
    if (!contentFailed) {
      return <div id="top" className="landing-shell min-h-screen" aria-busy="true" />;
    }
    const errorCopy = ERROR_COPY[locale];
    return (
      <div id="top" className="landing-shell flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{errorCopy.title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{errorCopy.description}</p>
          <button
            type="button"
            className="cta-primary mt-6 px-6 py-3"
            onClick={() => {
              // A failed dynamic import is retained by the browser's module
              // map, so a fresh import() cannot recover. Reload the document
              // to fetch the chunk again.
              if (typeof window !== 'undefined') {
                window.location.reload();
              }
            }}
          >
            {errorCopy.retry}
          </button>
        </div>
      </div>
    );
  }

  const sectionNavItems: Array<{ href: string; label: string; external?: boolean }> = [
    { href: '#apps', label: content.nav.apps },
    { href: '#worlds', label: content.nav.worlds },
    { href: '#create', label: content.nav.create },
    { href: '#developers', label: content.nav.developers },
    { href: links.docsUrl, label: content.nav.docs, external: true },
  ];

  const changeLocale = (nextLocale: LandingLocale) => {
    if (typeof window !== 'undefined') {
      const nextUrl = applyLocaleToLocation(
        { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash },
        nextLocale,
      );
      window.history.replaceState(null, '', nextUrl);
    }
    setLocale(nextLocale);
    persistLocale(nextLocale, getBrowserStorage());
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div
      id="top"
      className="landing-shell min-h-screen text-slate-900"
      // Native drag of selected text enters a browser-level drag loop that
      // hangs the page on some software-rendered environments. The landing has
      // no drag targets, so suppress drag initiation; selection and copy work.
      onDragStart={(event) => event.preventDefault()}
    >
      <a href="#main-content" className="skip-link">
        {content.skipToContent}
      </a>

      <header className={scrolled ? 'landing-header landing-header--scrolled' : 'landing-header'}>
        <div className="landing-header-inner">
          <div className="landing-header-bar relative flex items-center justify-start py-3.5">
            <a
              href="#top"
              className="flex items-center gap-2.5 rounded-control-sm px-2 py-1 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38d6a3]"
            >
              <img src="/logo.svg" alt="Nimi" className="h-8 w-8" />
              <span className="font-brand text-xl font-semibold tracking-tight text-ink">
                Nimi
              </span>
            </a>

            <nav
              aria-label={content.nav.menu}
              className="hidden lg:ml-3 lg:block xl:absolute xl:left-1/2 xl:ml-0 xl:-translate-x-1/2"
            >
              <ul className="flex items-center justify-center gap-1 text-slate-900">
                {sectionNavItems.map((item) => (
                  <li key={`${item.label}-${item.href}`}>
                    <a
                      className="nav-anchor"
                      href={item.href}
                      target={item.external ? '_blank' : undefined}
                      rel={item.external ? 'noreferrer' : undefined}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Utilities (language, community links) stay quiet and grouped;
                the download action is the only element with visual weight. */}
            <div className="ml-auto flex items-center gap-1">
              <button
                ref={menuButtonRef}
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-control-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38d6a3] lg:hidden"
                aria-expanded={menuOpen}
                aria-controls="landing-nav-menu"
                aria-label={menuOpen ? content.nav.closeMenu : content.nav.openMenu}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
                  {menuOpen ? (
                    <>
                      <path d="M6 6l12 12" />
                      <path d="M18 6 6 18" />
                    </>
                  ) : (
                    <>
                      <path d="M4 7h16" />
                      <path d="M4 12h16" />
                      <path d="M4 17h16" />
                    </>
                  )}
                </svg>
              </button>
              <div className="hidden lg:block">
                <LanguageToggle
                  locale={locale}
                  label={content.localeToggleLabel}
                  options={content.localeOptions}
                  onChange={changeLocale}
                />
              </div>
              <a
                href={links.discordUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={content.nav.discord}
                className="hidden h-8 w-8 items-center justify-center rounded-control-sm text-slate-400 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38d6a3] sm:inline-flex"
              >
                <DiscordIcon />
              </a>
              <a
                href={links.githubUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={content.footer.githubLabel}
                className="hidden h-8 w-8 items-center justify-center rounded-control-sm text-slate-400 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38d6a3] sm:inline-flex"
              >
                <GithubIcon />
              </a>
              <span aria-hidden="true" className="mx-2 hidden h-5 w-px bg-slate-200 sm:block" />
              <a
                href={links.downloadUrl}
                className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full bg-gradient-to-r from-[#38d6a3] to-[#0ea5e9] px-5 text-base font-semibold text-white shadow-[0_4px_12px_-6px_rgba(14,165,233,0.5)] transition hover:brightness-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38d6a3] focus-visible:ring-offset-1"
              >
                {content.hero.downloadCta}
              </a>
            </div>
          </div>

          <div
            id="landing-nav-menu"
            hidden={!menuOpen}
            className="border-t border-slate-100 pb-4 pt-2 lg:hidden"
          >
            <ul className="flex flex-col gap-1 text-slate-900">
              {sectionNavItems.map((item) => (
                <li key={`menu-${item.label}-${item.href}`}>
                  <a
                    className="nav-anchor block w-full"
                    href={item.href}
                    target={item.external ? '_blank' : undefined}
                    rel={item.external ? 'noreferrer' : undefined}
                    onClick={closeMenu}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 lg:hidden">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                {content.localeToggleLabel}
              </span>
              <LanguageToggle
                locale={locale}
                label={content.localeToggleLabel}
                options={content.localeOptions}
                onChange={changeLocale}
              />
            </div>
          </div>
        </div>
      </header>

      <main id="main-content">
        <HeroSection
          content={content.hero}
          links={links}
          demoSurfaceOverride={heroAppsMorph.heroSurfaceOverride}
          demoExpanded={heroAppsMorph.heroDemoExpanded}
        />
        <AppsSection content={content.apps} demo={content.hero.demo} />
        <WorldsSection content={content.worlds} links={links} />
        <CapabilitiesSection content={content.capabilities} links={links} />
        <CreateSection content={content.create} links={links} />
        <ContinuitySection content={content.continuity} />
        <DevelopersSection content={content.developers} links={links} />
        <GetStartedSection content={content.getStarted} links={links} />
      </main>

      <footer className="border-t border-slate-200 pb-12 pt-10">
        <div className="container-nimi flex flex-col gap-8">
          <div className="flex flex-col gap-6 md:flex-row md:justify-between">
            <div>
              <p className="text-base font-semibold tracking-tight text-slate-700">{content.footer.line1}</p>
              <p className="mt-1 text-sm text-slate-500">{content.footer.line2}</p>
            </div>
            <nav aria-label={content.footer.navLabel}>
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                <li><a href="#apps" className="transition hover:text-slate-900">{content.footer.appsLabel}</a></li>
                <li><a href="#worlds" className="transition hover:text-slate-900">{content.footer.worldsLabel}</a></li>
                <li><a href="#create" className="transition hover:text-slate-900">{content.footer.createLabel}</a></li>
                <li><a href="#developers" className="transition hover:text-slate-900">{content.footer.developersLabel}</a></li>
                <li><a href={links.docsUrl} target="_blank" rel="noreferrer" className="transition hover:text-slate-900">{content.footer.docsLabel}</a></li>
                <li><a href={links.githubUrl} target="_blank" rel="noreferrer" className="transition hover:text-slate-900">{content.footer.githubLabel}</a></li>
                <li><a href={links.discordUrl} target="_blank" rel="noreferrer" className="transition hover:text-slate-900">{content.nav.discord}</a></li>
              </ul>
            </nav>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-100 pt-6 text-sm text-slate-500 md:flex-row md:items-end md:justify-between">
            <p className="font-medium text-slate-600">Nimi Network Limited</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:justify-end">
              <a href={links.downloadUrl} className="transition hover:text-slate-900">{content.footer.downloadLabel}</a>
              <a href="/code-signing" className="transition hover:text-slate-900">{content.footer.codeSigningLabel}</a>
              <a
                href="https://github.com/nimiplatform/nimi/security/advisories/new"
                className="transition hover:text-slate-900"
              >
                {content.footer.securityLabel}
              </a>
              <a href="/terms.html" className="transition hover:text-slate-900">{content.footer.termsLabel}</a>
              <a href="/privacy.html" className="transition hover:text-slate-900">{content.footer.privacyLabel}</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

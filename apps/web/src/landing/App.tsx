import { useEffect, useMemo, useState } from 'react';
import { DesktopSection } from './components/desktop-section.js';
import { FaqSection } from './components/faq-section.js';
import { HeroSection } from './components/hero-section.js';
import { ArchitectureSection } from './components/architecture-section.js';
import { LanguageToggle } from './components/language-toggle.js';
import { ModelCatalogOverviewSection } from './components/model-catalog-overview-section.js';
import { ModsSection } from './components/mods-section.js';
import { OpenSourceSection } from './components/open-source-section.js';
import { SecuritySection } from './components/security-section.js';
import { SdkSection } from './components/sdk-section.js';
import { loadLandingContent, type LandingContent } from './content/landing-content.js';
import { resolveLandingLinks } from './config/landing-links.js';
import {
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

export function App() {
  const links = useMemo(() => resolveLandingLinks(import.meta.env), []);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [locale, setLocale] = useState<LandingLocale>(() => resolveInitialLocale({
    storage: getBrowserStorage(),
    navigatorLanguage: getBrowserLanguage(),
    defaultLocale: import.meta.env.VITE_LANDING_DEFAULT_LOCALE,
  }));
  const [content, setContent] = useState<LandingContent | null>(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  useEffect(() => {
    let cancelled = false;

    void loadLandingContent(locale).then((nextContent) => {
      if (!cancelled) {
        setContent(nextContent);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (!content) {
    return null;
  }
  const sectionNavItems: Array<{ href: string; label: string; external?: boolean }> = [
    { href: '#install', label: content.nav.install },
    { href: '#sdk', label: content.nav.sdk },
    { href: '#catalog', label: content.nav.catalog },
    { href: '#architecture', label: content.nav.architecture },
    { href: '#desktop', label: content.nav.desktop },
    { href: '#security', label: content.nav.security },
    { href: '#mods', label: content.nav.mods },
  ];

  return (
    <div id="top" className="landing-shell min-h-screen text-slate-900">
      <a href="#main-content" className="skip-link">
        {content.skipToContent}
      </a>

      <header className="landing-header">
        <div className="container-nimi relative flex items-center justify-start py-3">
          <a href="#top" className="flex items-center gap-3 rounded-xl px-2 py-1 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38d6a3]">
            <img src="/logo.svg" alt="Nimi" className="h-8 w-8" />
            <span className="font-heading text-lg font-semibold tracking-tight text-slate-900">Nimi</span>
          </a>

          <nav aria-label="Landing sections" className="absolute left-1/2 hidden -translate-x-1/2 lg:block">
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

          <div className="ml-auto flex items-center gap-2">
            <a
              href={links.discordUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Discord"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-700 transition hover:-translate-y-0.5 hover:border-[#38d6a3]/40 hover:bg-[#38d6a3]/10 hover:text-[#2ba980]"
            >
              <DiscordIcon />
            </a>
            <a
              href={links.githubUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-700 transition hover:-translate-y-0.5 hover:border-[#38d6a3]/40 hover:bg-[#38d6a3]/10 hover:text-[#2ba980]"
            >
              <GithubIcon />
            </a>
            <a
              href={links.webAppUrl}
              className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-4 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#2ba980]"
            >
              Enter Nimi
            </a>
          </div>
        </div>
      </header>

      <main id="main-content">
        <HeroSection content={content.hero} links={links} />
        <SdkSection content={content.sdk} locale={locale} />
        <ModelCatalogOverviewSection content={content.modelCatalog} locale={locale} query={catalogQuery} onQueryChange={setCatalogQuery} />
        <ArchitectureSection content={content.architecture} />
        <DesktopSection content={content.desktop} links={links} locale={locale} />
        <ModsSection content={content.mods} links={links} locale={locale} />
        <SecuritySection content={content.security} />
        <OpenSourceSection content={content.openSource} links={links} locale={locale} />
        <FaqSection content={content.faq} links={links} />
      </main>

      <footer className="pb-10 pt-2">
        <div className="container-nimi flex flex-col gap-5 text-sm text-slate-500 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-base font-semibold tracking-tight text-slate-700">{content.footer.line1}</p>
            <p className="mt-1 text-sm text-slate-500">{content.footer.line2}</p>
          </div>
          <div className="flex flex-col gap-2 text-sm text-slate-500 md:items-end">
            <p className="font-medium text-slate-600">Nimi Network Limited</p>
            <div className="flex items-center gap-4">
              <a href="/terms.html" className="transition hover:text-slate-900">
                {content.footer.termsLabel}
              </a>
              <a href="/privacy.html" className="transition hover:text-slate-900">
                {content.footer.privacyLabel}
              </a>
            </div>
          </div>
        </div>
      </footer>

      <div className="fixed bottom-5 right-5 z-[60] md:bottom-6 md:right-6">
        <LanguageToggle
          locale={locale}
          label={content.localeToggleLabel}
          options={content.localeOptions}
          onChange={(nextLocale) => {
            setLocale(nextLocale);
            persistLocale(nextLocale, getBrowserStorage());
          }}
        />
      </div>
    </div>
  );
}

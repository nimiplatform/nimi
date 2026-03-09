import { useEffect, useMemo, useState } from 'react';
import { DesktopSection } from './components/desktop-section.js';
import { FinalCtaSection } from './components/final-cta-section.js';
import { HeroSection } from './components/hero-section.js';
import { InstallSection } from './components/install-section.js';
import { LanguageToggle } from './components/language-toggle.js';
import { ModsSection } from './components/mods-section.js';
import { OpenSourceSection } from './components/open-source-section.js';
import { SdkSection } from './components/sdk-section.js';
import { getLandingContent } from './content/landing-content.js';
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

export function App() {
  const links = useMemo(() => resolveLandingLinks(import.meta.env), []);
  const [locale, setLocale] = useState<LandingLocale>(() => resolveInitialLocale({
    storage: getBrowserStorage(),
    navigatorLanguage: getBrowserLanguage(),
    defaultLocale: import.meta.env.VITE_LANDING_DEFAULT_LOCALE,
  }));

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const content = getLandingContent(locale);

  return (
    <div id="top" className="landing-shell min-h-screen text-slate-100">
      <a href="#main-content" className="skip-link">
        {content.skipToContent}
      </a>

      <header className="landing-header">
        <div className="container-nimi flex items-center justify-between gap-3 py-3">
          <a href="#top" className="flex items-center gap-3 rounded-xl px-2 py-1 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-200">
            <img src="/logo.svg" alt="Nimi" className="h-8 w-8" />
            <span className="font-heading text-lg font-semibold tracking-tight text-white">Nimi</span>
          </a>

          <nav aria-label="Landing sections" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              <li><a className="nav-anchor" href="#install">{content.nav.install}</a></li>
              <li><a className="nav-anchor" href="#sdk">{content.nav.sdk}</a></li>
              <li><a className="nav-anchor" href="#desktop">{content.nav.desktop}</a></li>
              <li><a className="nav-anchor" href="#mods">{content.nav.mods}</a></li>
            </ul>
          </nav>

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
      </header>

      <main id="main-content">
        <HeroSection content={content.hero} links={links} />
        <InstallSection content={content.install} links={links} />
        <SdkSection content={content.sdk} />
        <DesktopSection content={content.desktop} links={links} />
        <ModsSection content={content.mods} links={links} />
        <OpenSourceSection content={content.openSource} links={links} />
        <FinalCtaSection content={content.finalCta} links={links} />
      </main>

      <footer className="border-t border-white/10 bg-slate-950/65 py-8">
        <div className="container-nimi text-sm text-slate-300">
          <p>{content.footer.line1}</p>
          <p className="mt-2 text-slate-400">{content.footer.line2}</p>
        </div>
      </footer>
    </div>
  );
}

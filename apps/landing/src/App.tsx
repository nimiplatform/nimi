import { useEffect, useMemo, useState } from 'react';
import { FinalCtaSection } from './components/final-cta-section.js';
import { HeroSection } from './components/hero-section.js';
import { JourneySection } from './components/journey-section.js';
import { LanguageToggle } from './components/language-toggle.js';
import { OpenSourceSection } from './components/open-source-section.js';
import { ProtocolSection } from './components/protocol-section.js';
import { QuickstartSection } from './components/quickstart-section.js';
import { SecuritySection } from './components/security-section.js';
import { StackSection } from './components/stack-section.js';
import { ValueSection } from './components/value-section.js';
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
              <li><a className="nav-anchor" href="#for-builders">{content.nav.builders}</a></li>
              <li><a className="nav-anchor" href="#for-users">{content.nav.users}</a></li>
              <li><a className="nav-anchor" href="#protocol">{content.nav.protocol}</a></li>
              <li><a className="nav-anchor" href="#security">{content.nav.security}</a></li>
              <li><a className="nav-anchor" href="#quickstart">{content.nav.quickstart}</a></li>
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
        <ValueSection content={content.why} />
        <StackSection content={content.stack} />
        <ProtocolSection content={content.protocol} />
        <SecuritySection content={content.security} />
        <QuickstartSection content={content.quickstart} links={links} />
        <JourneySection content={content.journey} />
        <OpenSourceSection content={content.openSource} />
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

import { useEffect, useMemo, useState } from 'react';
import { HeroDemoSessionProvider } from './components/hero-demo-session.js';
import { StoryPage } from './components/story/story-page.js';
import { getStoryCopy } from './content/story-copy.js';
import { loadLandingContent, type LandingContent } from './content/landing-content.js';
import { resolveLandingLinks, resolveLocalizedLinks } from './config/landing-links.js';
import { applyLocaleToLocation, persistLocale, resolveInitialLocale, type LandingLocale } from './i18n/locale.js';
import { useHashScroll } from './hooks/use-hash-scroll.js';
import { loadWebLocaleFont } from '../fonts.js';

export function App() {
  const [locale, setLocale] = useState<LandingLocale>(() => resolveInitialLocale({
    storage: typeof window === 'undefined' ? null : window.localStorage,
    search: typeof window === 'undefined' ? '' : window.location.search,
    navigatorLanguage: typeof navigator === 'undefined' ? '' : navigator.language,
    defaultLocale: import.meta.env.VITE_LANDING_DEFAULT_LOCALE,
  }));
  const copy = getStoryCopy(locale);
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
  const links = useMemo(() => resolveLocalizedLinks(baseLinks, locale), [baseLinks, locale]);
  const [content, setContent] = useState<LandingContent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let canceled = false;
    setFailed(false);
    void loadLandingContent(locale).then(next => { if (!canceled) setContent(next); }).catch(() => { if (!canceled) setFailed(true); });
    return () => { canceled = true; };
  }, [locale]);
  useHashScroll(Boolean(content && content.hero.demo.appPreview.locale === locale));
  useEffect(() => {
    document.documentElement.lang = locale;
    loadWebLocaleFont(locale);
    const title = copy['hero.metaTitle'], description = copy['hero.metaDescription'];
    document.title = title;
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute('href', 'https://nimi.ai');
    for (const [selector, value] of [
      ['meta[name="description"]', description], ['meta[property="og:title"]', title],
      ['meta[property="og:description"]', description], ['meta[property="og:url"]', 'https://nimi.ai'],
      ['meta[name="twitter:title"]', title], ['meta[name="twitter:description"]', description],
    ]) {
      const element = document.querySelector<HTMLMetaElement>(selector!);
      if (element) element.content = value!;
    }
  }, [locale, copy]);
  const changeLocale = (next: LandingLocale) => {
    window.history.replaceState(null, '', applyLocaleToLocation(window.location, next));
    persistLocale(next, window.localStorage); setLocale(next);
  };
  if (!content || content.hero.demo.appPreview.locale !== locale) return <div className="story-site story-initial-loading" role="status"><img src="/logo.svg" alt="Nimi" /><p>{copy[failed ? 'common.loadError' : 'common.loading']}</p>{failed && <button type="button" onClick={() => window.location.reload()}>{copy['common.retry']}</button>}</div>;
  return <HeroDemoSessionProvider key={locale} demo={content.hero.demo}><StoryPage content={content} links={links} locale={locale} onLocale={changeLocale} /></HeroDemoSessionProvider>;
}

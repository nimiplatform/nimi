import { useMemo } from 'react';
import { HeroDemoSessionProvider } from './components/hero-demo-session.js';
import { StoryPage } from './components/story/story-page.js';
import { getStoryCopy } from './content/story-copy.js';
import { DEFAULT_STORY_AGENT } from './content/story-model.js';
import { createCoreHeroDemo } from './content/core-hero-demo.js';
import { useHashScroll } from './hooks/use-hash-scroll.js';
import { usePublicDocumentMetadata, useResolvedPublicLinks } from '../pages/public-site-shell.js';
import { usePublicPageLocale } from '../pages/use-page-locale.js';

export function App() {
  const [locale, setLocale] = usePublicPageLocale();
  const copy = getStoryCopy(locale);
  const demo = useMemo(() => createCoreHeroDemo(locale), [locale]);
  const links = useResolvedPublicLinks(locale);

  useHashScroll(true);
  usePublicDocumentMetadata(copy['hero.metaTitle'], copy['hero.metaDescription'], '/', locale);

  return (
    <HeroDemoSessionProvider key={locale} demo={demo} initialSurface="home" initialTarget={DEFAULT_STORY_AGENT}>
      <StoryPage links={links} locale={locale} onLocale={setLocale} />
    </HeroDemoSessionProvider>
  );
}

import { Surface } from '@nimiplatform/kit/ui';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, Menu, UserRound, X } from 'lucide-react';
import type { LandingContent, HeroDemoSurface } from '../../content/landing-content.js';
import type { LandingLinks } from '../../config/landing-links.js';
import { getStoryCopy, type StoryText } from '../../content/story-copy.js';
import { DEFAULT_STORY_AGENT, storyAgent } from '../../content/story-model.js';
import { useHeroDemoSession } from '../hero-demo-context.js';
import { HeroDemoSessionProvider } from '../hero-demo-session.js';
import { LanguageToggle } from '../language-toggle.js';
import { StoryHome } from './story-home.js';
import { StoryExperience } from './story-experience.js';
import { StoryWorlds } from './story-worlds.js';
import { StoryIntegrations } from './story-capabilities.js';
import { StoryApps } from './story-apps.js';
import { StoryBuilder } from './story-builder.js';
import { StoryLink } from './story-shared.js';
import { useStoryHeroMotion, useStoryMotion } from './story-motion.js';

const navigation = [
  ['hero-demo', 'nav.experience'],
  ['apps', 'nav.capabilities'],
  ['app-showcase', 'nav.apps'],
  ['integrations', 'nav.integrations'],
  ['developers', 'nav.developers'],
  ['worlds', 'nav.worlds'],
] as const;

// @nimi-authority: rule.nimi.platform.core-protocol.p-arch-001a
export function StoryPage({ content, links, locale, onLocale }: { content: LandingContent; links: LandingLinks; locale: 'zh' | 'en'; onLocale: (locale: 'zh' | 'en') => void }) {
  const copy = getStoryCopy(locale);
  const t: StoryText = key => copy[key];
  const headline = /^(.*?)([.!?。！？])$/u.exec(t('hero.title'));
  const session = useHeroDemoSession();
  const site = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  const heroStage = useRef<HTMLDivElement>(null);
  useStoryMotion(site);
  useStoryHeroMotion(hero);
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuPanel.current?.querySelector('a')?.focus({ preventScroll: true });
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setMenu(false);
      menuButton.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);
  const [selectedId, setSelectedId] = useState(DEFAULT_STORY_AGENT);
  const [expandedHome, setExpandedHome] = useState(false);
  const [expandedHero, setExpandedHero] = useState(false);
  const agent = storyAgent(session.demo, selectedId);
  const openHome = (surface: HeroDemoSurface, target?: string) => { session.navigate(surface, target); setExpandedHome(true); };
  const openApp = (id: string) => session.openPreview(id, id === 'nimi.zhiyu' ? 'companion' : 'home', id === 'nimi.zhiyu' ? agent.id : undefined);
  useEffect(() => {
    const { surface, target } = session.current;
    const id = surface === 'chat' ? target : surface === 'explore' && target?.startsWith('partner:') ? target.slice(8) : undefined;
    if (id && session.demo.chat.agents.some(candidate => candidate.id === id)) {
      setSelectedId(id);
    }
  }, [session.current.surface, session.current.target, session.demo.chat.agents]);
  return <div ref={site} className="story-site" id="top" lang={locale === 'zh' ? 'zh-CN' : 'en'}>
    <a className="skip-link" href="#main-content">{t('common.skip')}</a>
    <Surface as="header" material="glass-chrome" padding="none" className="story-nav"><a className="story-brand" href="#top"><img src="/logo.svg" alt="" /><strong>Nimi</strong></a>
      <nav id="story-navigation" ref={menuPanel} aria-label="Nimi" className={menu ? 'is-open' : ''}>
        {navigation.map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => setMenu(false)}>{t(label)}</a>)}
      </nav>
      <div className="story-nav-actions"><LanguageToggle locale={locale} label={t('common.language')} options={content.localeOptions} onChange={value => { setMenu(false); onLocale(value); }} /><a className="story-account" href={`/account?lang=${locale}`} aria-label={t('common.account')}><UserRound size={19} /></a><a className="story-download" href={links.downloadUrl}>{t('common.download')}<ArrowUpRight size={15} aria-hidden="true" /></a><button ref={menuButton} className="story-menu-toggle" type="button" aria-controls="story-navigation" aria-expanded={menu} aria-label={t(menu ? 'common.closeMenu' : 'common.openMenu')} onClick={() => setMenu(!menu)}>{menu ? <X size={21} /> : <Menu size={21} />}</button></div>
    </Surface>
    <main id="main-content">
      <section ref={hero} className="story-hero" aria-labelledby="story-title">
        <div className="story-hero-copy">
          <h1 id="story-title" aria-label={t('hero.title')}>{headline ? <>{headline[1]}<span className="story-title-accent">{headline[2]}</span></> : t('hero.title')}</h1>
          <a className="story-hero-continue" href="#hero-demo" onClick={event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const stage = heroStage.current;
            if (!stage) return;
            event.preventDefault();
            if (window.location.hash !== '#hero-demo') window.history.pushState(null, '', '#hero-demo');
            stage.focus({ preventScroll: true });
            stage.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
          }}><span>{t('hero.continue')}</span><ArrowDown size={16} aria-hidden="true" /></a>
        </div>
        <div ref={heroStage} id="hero-demo" className="story-hero-stage" tabIndex={-1}>
          <HeroDemoSessionProvider demo={content.hero.demo}>
            <StoryHome t={t} expanded={expandedHero} onExpanded={setExpandedHero} layout="hero" />
          </HeroDemoSessionProvider>
        </div>
      </section>
      <StoryExperience t={t} partnerId={agent.id} onHome={openHome} />
      <section id="home-demo" className="story-section story-runtime" aria-labelledby="runtime-heading" data-story-scene>
        <header className="story-heading story-container">
          <h2 id="runtime-heading">{t('runtime.title')}</h2>
          <p>{t('runtime.description')}</p>
        </header>
        <div className="story-home-stage">
          <StoryHome t={t} expanded={expandedHome} onExpanded={setExpandedHome} />
        </div>
      </section>
      <StoryApps t={t} onApp={openApp} />
      <StoryIntegrations t={t} links={links} />
      <StoryBuilder t={t} links={links} />
      <StoryWorlds t={t} locale={locale} onOpenWorld={id => openHome('explore', `world:${id}`)} />
      <section className="story-ending">
        <div className="story-container">
          <h2>{t('footer.heading')}</h2>
          <StoryLink href={links.downloadUrl} primary>{t('common.download')}</StoryLink>
        </div>
      </section>
    </main>
    <footer className="story-footer story-container"><a href="#top" className="story-brand"><img src="/logo.svg" alt="" /><strong>Nimi</strong></a><span>Nimi Network Limited</span><div><a href={links.githubUrl}>{t('footer.github')}</a><a href={links.discordUrl}>{t('footer.discord')}</a><a href={links.downloadUrl}>{t('footer.downloadStatus')}</a><a href="/code-signing">{t('footer.signing')}</a><a href="https://github.com/nimiplatform/nimi/security/advisories/new">{t('footer.securityReport')}</a><a href="/terms.html">{t('footer.terms')}</a><a href="/privacy.html">{t('footer.privacy')}</a></div></footer>
  </div>;
}

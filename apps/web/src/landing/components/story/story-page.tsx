import { Surface } from '@nimiplatform/kit/ui';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Menu, UserRound, X } from 'lucide-react';
import type { LandingContent, HeroDemoSurface } from '../../content/landing-content.js';
import type { LandingLinks } from '../../config/landing-links.js';
import { getStoryCopy, type StoryKey, type StoryText } from '../../content/story-copy.js';
import { DEFAULT_STORY_AGENT, STORY_SECTIONS, storyAgent } from '../../content/story-model.js';
import { useHeroDemoSession } from '../hero-demo-context.js';
import { LanguageToggle } from '../language-toggle.js';
import { StoryHome } from './story-home.js';
import { StoryExperience } from './story-experience.js';
import { StoryWorlds } from './story-worlds.js';
import { StoryPower, StoryIntegrations } from './story-capabilities.js';
import { StoryApps } from './story-apps.js';
import { StoryBuilder } from './story-builder.js';
import { StoryLink } from './story-shared.js';
import { useStoryMotion } from './story-motion.js';

export function StoryPage({ content, links, locale, onLocale }: { content: LandingContent; links: LandingLinks; locale: 'zh' | 'en'; onLocale: (locale: 'zh' | 'en') => void }) {
  const copy = getStoryCopy(locale);
  const t: StoryText = key => copy[key];
  const headline = /^(.*?)([.!?。！？])$/u.exec(t('hero.title'));
  const session = useHeroDemoSession();
  const site = useRef<HTMLDivElement>(null);
  useStoryMotion(site);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 16);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuPanel.current?.querySelector<HTMLAnchorElement>('a')?.focus({ preventScroll: true });
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); menuButton.current?.focus({ preventScroll: true }); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);
  const [selectedId, setSelectedId] = useState(DEFAULT_STORY_AGENT);
  const [expandedHome, setExpandedHome] = useState(false);
  const agent = storyAgent(session.demo, selectedId);
  const labels: StoryKey[] = ['common.experience','common.worlds','common.power','common.showcase','common.integrations','common.build'];
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
    <Surface as="header" material="glass-chrome" padding="none" className={`story-nav${scrolled ? ' story-nav--scrolled' : ''}`}><a className="story-brand" href="#top"><img src="/logo.svg" alt="" /><strong>Nimi</strong></a>
      <nav id="story-navigation" ref={menuPanel} aria-label="Nimi" className={menu ? 'is-open' : ''}>{STORY_SECTIONS.map((id,index) => <a key={id} href={`#${id}`} onClick={() => setMenu(false)}>{t(labels[index]!)}</a>)}</nav>
      <div className="story-nav-actions"><LanguageToggle locale={locale} label={t('common.language')} options={content.localeOptions} onChange={value => { setMenu(false); onLocale(value); }} /><a className="story-account" href={`/account?lang=${locale}`} aria-label={t('common.account')}><UserRound size={19} /></a><a className="story-download" href={links.downloadUrl}>{t('common.download')}<ArrowUpRight size={15} /></a><button ref={menuButton} className="story-menu-toggle" type="button" aria-controls="story-navigation" aria-expanded={menu} aria-label={t(menu ? 'common.closeMenu' : 'common.openMenu')} onClick={() => setMenu(!menu)}>{menu ? <X size={21} /> : <Menu size={21} />}</button></div>
    </Surface>
    <main id="main-content">
      <section className="story-hero" aria-labelledby="story-title"><div className="hero-backdrop" aria-hidden="true" /><div className="story-hero-layout"><div className="story-hero-copy"><span className="story-eyebrow">{t('hero.eyebrow')}</span><h1 id="story-title" aria-label={t('hero.title')}>{headline ? <>{headline[1]}<span className="story-title-accent">{headline[2]}</span></> : t('hero.title')}</h1><p className="story-hero-description">{t('hero.body')}</p><p className="story-hero-note">{t('hero.note')}</p><a className="story-hero-continue" href="#apps"><ArrowDown size={20} /><span>{t('hero.continue')}</span></a></div><StoryHome t={t} expanded={expandedHome} onExpanded={setExpandedHome} /></div></section>
      <StoryExperience key={agent.id} t={t} agent={agent} onApp={openApp} onHome={id => openHome('chat', id ?? undefined)} />
      <StoryWorlds t={t} locale={locale} onOpenWorld={id => openHome('explore', `world:${id}`)} />
      <StoryPower t={t} links={links} onHome={openHome} />
      <StoryApps t={t} onApp={openApp} />
      <StoryIntegrations t={t} links={links} onHome={() => openHome('integrations')} />
      <StoryBuilder t={t} links={links} />
      <section className="story-ending"><div className="story-container"><span className="story-eyebrow">NIMI</span><h2>{t('footer.heading')}</h2><p>{t('footer.body')}</p><StoryLink href={links.downloadUrl} primary>{t('common.download')}</StoryLink><small>{t('footer.cost')}</small></div></section>
    </main>
    <footer className="story-footer story-container"><a href="#top" className="story-brand"><img src="/logo.svg" alt="" /><strong>Nimi</strong></a><span>Nimi Network Limited</span><div><a href={links.githubUrl}>{t('footer.github')}</a><a href={links.discordUrl}>{t('footer.discord')}</a><a href={links.downloadUrl}>{t('footer.downloadStatus')}</a><a href="/code-signing">{t('footer.signing')}</a><a href="https://github.com/nimiplatform/nimi/security/advisories/new">{t('footer.securityReport')}</a><a href="/terms.html">{t('footer.terms')}</a><a href="/privacy.html">{t('footer.privacy')}</a></div></footer>
  </div>;
}

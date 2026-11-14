import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Blocks,
  BrainCircuit,
  Code2,
  Compass,
  Cpu,
  Layers3,
  ShieldCheck,
} from 'lucide-react';
import type { HeroDemoSurface } from '../../content/landing-content.js';
import { withLocaleQuery, type LandingLinks } from '../../config/landing-links.js';
import { getStoryCopy, type StoryText } from '../../content/story-copy.js';
import { DEFAULT_STORY_AGENT, storyAgent } from '../../content/story-model.js';
import { useHeroDemoSession } from '../hero-demo-context.js';
import { StoryHome } from './story-home.js';
import { StoryExperience } from './story-experience.js';
import { StoryLink } from './story-shared.js';
import { useStoryHeroMotion, useStoryMotion } from './story-motion.js';
import { PublicSiteFooter, PublicSiteHeader, PublicSiteLink } from '../../../pages/public-site-shell.js';

// @nimi-authority: rule.nimi.platform.core-protocol.p-arch-001a
// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-positioning
export function StoryPage({
  links,
  locale,
  onLocale,
}: {
  links: LandingLinks;
  locale: 'zh' | 'en';
  onLocale: (locale: 'zh' | 'en') => void;
}) {
  const copy = getStoryCopy(locale);
  const t: StoryText = (key) => copy[key];
  const headline = /^(.*?)([.!?。！？])$/u.exec(t('hero.title'));
  const session = useHeroDemoSession();
  const site = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  const heroStage = useRef<HTMLDivElement>(null);
  useStoryMotion(site);
  useStoryHeroMotion(hero);

  const [selectedId, setSelectedId] = useState(DEFAULT_STORY_AGENT);
  const [expandedHome, setExpandedHome] = useState(false);
  const [expandedHero, setExpandedHero] = useState(false);
  const agent = storyAgent(session.demo, selectedId);

  const openHome = (surface: HeroDemoSurface, target?: string) => {
    session.navigate(surface, target);
    setExpandedHome(true);
  };

  useEffect(() => {
    const { surface, target } = session.current;
    const id = surface === 'chat'
      ? target
      : surface === 'explore' && target?.startsWith('partner:')
        ? target.slice(8)
        : undefined;
    if (id && session.demo.chat.agents.some((candidate) => candidate.id === id)) {
      setSelectedId(id);
    }
  }, [session.current.surface, session.current.target, session.demo.chat.agents]);

  const foundationPillars = [
    {
      index: '01',
      Icon: Cpu,
      title: t('pillars.computeTitle'),
      body: t('pillars.computeBody'),
    },
    {
      index: '02',
      Icon: BrainCircuit,
      title: t('pillars.contextTitle'),
      body: t('pillars.contextBody'),
    },
    {
      index: '03',
      Icon: ShieldCheck,
      title: t('pillars.governanceTitle'),
      body: t('pillars.governanceBody'),
    },
  ] as const;

  const featuredCompanions = session.demo.chat.agents.slice(0, 4);
  const featuredApps = [
    '/demo/zhiyu-icon.png',
    '/demo/parentos-icon.png',
    '/demo/vane-icon.png',
    '/demo/videolingo-icon.png',
    '/demo/shijing-icon.png',
  ] as const;

  const productPortals = [
    {
      id: 'home',
      href: withLocaleQuery('/home', locale),
      Icon: Compass,
      badge: t('portals.homeBadge'),
      title: t('portals.homeTitle'),
      body: t('portals.homeBody'),
      action: t('portals.homeAction'),
      visual: (
        <div className="story-portal-visual story-portal-avatars" aria-hidden="true">
          {featuredCompanions.map((companion) => (
            <img
              key={companion.id}
              src={companion.avatarUrl}
              alt=""
              width={32}
              height={32}
              loading="lazy"
              decoding="async"
            />
          ))}
        </div>
      ),
    },
    {
      id: 'apps',
      href: withLocaleQuery('/apps', locale),
      Icon: Blocks,
      badge: t('portals.appsBadge'),
      title: t('portals.appsTitle'),
      body: t('portals.appsBody'),
      action: t('portals.appsAction'),
      visual: (
        <div className="story-portal-visual story-portal-icons" aria-hidden="true">
          {featuredApps.map((iconSrc) => (
            <img
              key={iconSrc}
              src={iconSrc}
              alt=""
              width={30}
              height={30}
              loading="lazy"
              decoding="async"
            />
          ))}
        </div>
      ),
    },
    {
      id: 'platform',
      href: withLocaleQuery('/platform', locale),
      Icon: Layers3,
      badge: t('portals.platformBadge'),
      title: t('portals.platformTitle'),
      body: t('portals.platformBody'),
      action: t('portals.platformAction'),
      visual: (
        <div className="story-portal-visual story-portal-tags" aria-hidden="true">
          <span>Runtime</span>
          <span>Cognition</span>
          <span>Realm</span>
          <span>{locale === 'zh' ? '11 项能力' : '11 Modalities'}</span>
        </div>
      ),
    },
    {
      id: 'developers',
      href: withLocaleQuery('/developers', locale),
      Icon: Code2,
      badge: t('portals.developersBadge'),
      title: t('portals.developersTitle'),
      body: t('portals.developersBody'),
      action: t('portals.developersAction'),
      visual: (
        <div className="story-portal-visual story-portal-tags is-mono" aria-hidden="true">
          <span>@nimiplatform/sdk</span>
          <span>Vercel AI</span>
          <span>Kit</span>
          <span>App Tools</span>
        </div>
      ),
    },
  ] as const;

  return (
    <div
      ref={site}
      className="story-site"
      id="top"
      lang={locale === 'zh' ? 'zh-CN' : 'en'}
      onDragStart={(event) => event.preventDefault()}
    >
      <a className="skip-link" href="#main-content">
        {t('common.skip')}
      </a>
      <PublicSiteHeader
        locale={locale}
        onLocaleChange={onLocale}
        activePath="/"
        navId="story-navigation"
      />
      <main id="main-content">
        <section ref={hero} className="story-hero" aria-labelledby="story-title">
          <div className="story-hero-copy">
            <span className="story-hero-eyebrow">{t('hero.eyebrow')}</span>
            <h1 id="story-title" aria-label={t('hero.title')}>
              {headline ? (
                <>
                  {headline[1]}
                  <span className="story-title-accent">{headline[2]}</span>
                </>
              ) : (
                t('hero.title')
              )}
            </h1>
            <p className="story-hero-lead">{t('hero.lead')}</p>
            <div className="story-hero-actions">
              <StoryLink href={links.downloadUrl} primary>
                {t('common.download')}
              </StoryLink>
              <a
                className="story-hero-continue"
                href="#hero-demo"
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  const stage = heroStage.current;
                  if (!stage) return;
                  event.preventDefault();
                  if (window.location.hash !== '#hero-demo') window.history.pushState(null, '', '#hero-demo');
                  stage.focus({ preventScroll: true });
                  stage.scrollIntoView({
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
                  });
                }}
              >
                <span>{t('hero.continue')}</span>
                <ArrowDown size={16} aria-hidden="true" />
              </a>
            </div>
            <p className="story-hero-availability">{t('hero.availability')}</p>
          </div>
          <div ref={heroStage} id="hero-demo" className="story-hero-stage" tabIndex={-1}>
            <StoryHome
              t={t}
              expanded={expandedHero}
              onExpanded={setExpandedHero}
              layout="hero"
              continuitySwitcher={{
                partnerId: agent.id,
                zhiyuWindowTitle: t('experience.continuityWindow'),
                hint: t('hero.continuityHint'),
                quickSendLabel: t('hero.continuityQuickSend'),
                sampleText: t('hero.continuitySampleText'),
                sampleReply: t('hero.continuitySampleReply'),
                tabZhiyu: t('hero.continuityTabZhiyu'),
                tabHomeChat: t('hero.continuityTabHomeChat'),
                tabHomeOverview: t('hero.continuityTabHomeOverview'),
                formatSyncedBadge: (count) => t('hero.continuitySyncedBadge').replace('{count}', String(count)),
              }}
              previewHeaderActions={
                session.preview?.appId === 'nimi.zhiyu' && session.preview.screen === 'companion' ? (
                  <button
                    type="button"
                    className="story-modal-handoff-btn"
                    onClick={() => {
                      const targetPartner = session.preview?.partnerId ?? agent.id;
                      session.closePreview();
                      openHome('chat', targetPartner);
                    }}
                  >
                    <img src="/logo.svg" alt="" width={14} height={14} />
                    <span>{t('experience.switchToHomeModal')}</span>
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                ) : undefined
              }
              disablePreviewModal={expandedHome}
            />
          </div>
        </section>

        <section
          id="foundation-pillars"
          className="story-section story-pillars"
          aria-labelledby="pillars-heading"
          data-story-scene
        >
          <div className="story-container">
            <header className="story-heading story-pillars-heading">
              <span className="story-eyebrow">{t('pillars.eyebrow')}</span>
              <h2 id="pillars-heading">{t('pillars.title')}</h2>
              <p>{t('pillars.body')}</p>
            </header>
            <div className="story-pillars-grid">
              {foundationPillars.map(({ index, Icon, title, body }) => (
                <article key={index} className="story-pillar-card">
                  <div className="story-pillar-card-top">
                    <span className="story-pillar-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <span className="story-ownership-number">{index}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <StoryExperience t={t} partnerId={agent.id} onHome={openHome} />

        <section
          id="home-demo"
          className="story-section story-runtime"
          aria-labelledby="runtime-heading"
          data-story-scene
        >
          <header className="story-heading story-container">
            <h2 id="runtime-heading">{t('runtime.title')}</h2>
            <p>{t('runtime.description')}</p>
          </header>
          <div className="story-home-stage">
            <StoryHome
              t={t}
              expanded={expandedHome}
              onExpanded={setExpandedHome}
              staticWhenDocked
              disablePreviewModal={!expandedHome}
              extraWindowActions={
                expandedHome && session.surface === 'chat' ? (
                  <button
                    type="button"
                    className="story-modal-handoff-btn"
                    onClick={() => {
                      const targetPartner = session.selectedChatTargetId ?? agent.id;
                      setExpandedHome(false);
                      session.openPreview('nimi.zhiyu', 'companion', targetPartner);
                    }}
                  >
                    <img src="/demo/zhiyu-icon.png" alt="" width={14} height={14} />
                    <span>{t('experience.switchToZhiyuModal')}</span>
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                ) : undefined
              }
            />
          </div>
          <p className="story-runtime-caption story-container">{t('runtime.caption')}</p>
        </section>

        <section
          id="explore-layers"
          className="story-section story-portals"
          aria-labelledby="portals-heading"
          data-story-scene
        >
          <div className="story-container">
            <header className="story-heading story-portals-heading">
              <span className="story-eyebrow">{t('portals.eyebrow')}</span>
              <h2 id="portals-heading">{t('portals.title')}</h2>
              <p>{t('portals.body')}</p>
            </header>
            <div className="story-portals-grid">
              {productPortals.map(({ id, href, Icon, badge, title, body, action, visual }) => (
                <PublicSiteLink key={id} to={href} className="story-portal-card" data-portal-id={id}>
                  <div className="story-portal-card-top">
                    <span className="story-portal-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <span className="story-portal-badge">{badge}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                  {visual}
                  <span className="story-portal-action">
                    <span>{action}</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </PublicSiteLink>
              ))}
            </div>
          </div>
        </section>

        <section className="story-ending">
          <div className="story-container">
            <h2>{t('footer.heading')}</h2>
            <div className="story-ending-actions">
              <StoryLink href={links.downloadUrl} primary>
                {t('common.download')}
              </StoryLink>
              <PublicSiteLink className="story-button story-button-outline" to={withLocaleQuery('/platform', locale)}>
                <span>{t('portals.platformAction')}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </PublicSiteLink>
            </div>
          </div>
        </section>
      </main>
      <PublicSiteFooter locale={locale} links={links} />
    </div>
  );
}

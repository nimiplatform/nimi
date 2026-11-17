import { lazy, startTransition, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { SegmentedControl } from '@nimiplatform/kit/ui';
import { Link, useLocation } from 'react-router-dom';
import type { StoryText } from '../../content/story-copy.js';
import { AppPreviewLocaleProvider } from '../../i18n/app-preview-locale.js';
import type { DemoNavigate } from '../demo-home.js';
import { DemoWindowHeader } from '../demo-window-header.js';
import { useHeroDemoSession } from '../hero-demo-context.js';
import { StoryHeading } from './story-shared.js';

const LocalModels = lazy(async () => ({ default: (await import('../demo-runtime.js')).DemoRuntimeSurface }));
const CloudModels = lazy(async () => ({ default: (await import('../demo-cloud.js')).DemoCloudSurface }));
const Zhiyu = lazy(async () => {
  if (typeof document !== 'undefined') {
    await import('../../demo-zhiyu.css');
  }
  return { default: (await import('../demo-zhiyu-preview.js')).DemoZhiyuPreview };
});
const HomeChat = lazy(async () => ({ default: (await import('../demo-chat.js')).DemoSessionChat }));
const chapters = ['models', 'memory', 'continuity'] as const;
type Chapter = typeof chapters[number];
const localCapability = 'text.generate';
const cloudCatalog = 'catalog';
const panelId = (chapter: Chapter) => `ownership-${chapter}`;
const stepId = (chapter: Chapter) => `${panelId(chapter)}-step`;

function ChapterSummary({ chapter, t }: { chapter: Chapter; t: StoryText }) {
  const noteKeys = {
    models: 'experience.modelsDataNote',
    memory: undefined,
    continuity: 'experience.continuityAccessNote',
  } as const;
  const noteKey = noteKeys[chapter];

  return <div className="story-ownership-summary">
    <p>{t(`experience.${chapter}Body`)}</p>
    {noteKey && <p className="story-ownership-summary-note">{t(noteKey)}</p>}
  </div>;
}

export function findActiveOwnershipChapter(starts: readonly number[], readingLine: number) {
  let current = 0;
  for (const [index, start] of starts.entries()) {
    if (start > readingLine) break;
    current = index;
  }
  return current;
}

export function getOwnershipChapterProgress(start: number, end: number) {
  // Start and end are distances from the current scroll position.
  return Math.max(0, Math.min(1, -start / Math.max(1, end - start)));
}

export function StoryExperience({ t, partnerId, onHome }: {
  t: StoryText;
  partnerId: string;
  onHome: DemoNavigate;
}) {
  const { search } = useLocation();
  const { demo, openPreview } = useHeroDemoSession();
  const preview = demo.appPreview;
  const copies = useRef<HTMLOListElement>(null);
  const scrollTrack = useRef<HTMLDivElement>(null);
  const stickyStage = useRef<HTMLDivElement>(null);
  const [activeChapter, setActiveChapter] = useState<Chapter>('models');
  const [mountedChapters, setMountedChapters] = useState<ReadonlySet<Chapter>>(
    () => new Set(['models']),
  );
  const [showCloud, setShowCloud] = useState(false);
  const [continuityApp, setContinuityApp] = useState('zhiyu');
  useEffect(() => {
    setMountedChapters((current) => {
      if (current.has(activeChapter)) return current;
      const next = new Set(current);
      next.add(activeChapter);
      return next;
    });
  }, [activeChapter]);

  useEffect(() => {
    const index = copies.current;
    const track = scrollTrack.current;
    const stage = stickyStage.current;
    if (!index || !track || !stage) return;
    const items = [...index.children] as HTMLElement[];
    const steps = [...track.children];
    const desktop = window.matchMedia('(min-width: 861px) and (min-height: 600px)');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!desktop.matches) {
        setShowCloud(false);
        setMountedChapters(current => current.size === chapters.length ? current : new Set(chapters));
        return;
      }
      if (document.querySelector('[role="dialog"]')) {
        return;
      }
      const stickyTop = Number.parseFloat(window.getComputedStyle(stage).top);
      const starts = steps.map(step => step.getBoundingClientRect().top);
      // Allow for fractional layout pixels when a hash jump aligns a step with the stage.
      const readingLine = stickyTop + 1;
      const activeIndex = findActiveOwnershipChapter(starts, readingLine);
      setActiveChapter(chapters[activeIndex]!);

      const end = starts[activeIndex + 1] ?? track.getBoundingClientRect().bottom - stage.offsetHeight;
      const activeProgress = getOwnershipChapterProgress(starts[activeIndex]! - readingLine, end - readingLine);
      items.forEach((item, index) => {
        const progress = index === activeIndex ? activeProgress : Number(index < activeIndex);
        item.style.setProperty('--ownership-progress', String(progress));
      });
      startTransition(() => setShowCloud(activeIndex > 0 || activeProgress >= 0.4));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    desktop.addEventListener('change', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      desktop.removeEventListener('change', schedule);
    };
  }, []);

  return <section className="story-section story-experience" id="apps" aria-labelledby="experience-heading">
    <div className="story-container story-experience-container">
      <div className="story-experience-intro">
        <StoryHeading t={t} section="experience" />
      </div>
      <div className="story-experience-composition">
        <div className="story-ownership-track" ref={scrollTrack} aria-hidden="true">
          {chapters.map(chapter => <div id={stepId(chapter)} key={chapter} />)}
        </div>
        <div className="story-ownership-stage" ref={stickyStage}>
          <ol className="story-ownership-index" aria-label={t('experience.title')} ref={copies}>
            {chapters.map((chapter) => {
              const active = activeChapter === chapter;
              const hash = `#${panelId(chapter)}`;
              return <li key={chapter} data-active={active}>
                <Link
                  to={{ search, hash }}
                  aria-current={active ? 'location' : undefined}
                >
                  {t(`experience.${chapter}Title`)}
                </Link>
                <div className="story-ownership-details" aria-hidden={!active}>
                  <div className="story-ownership-details-clip"><ChapterSummary chapter={chapter} t={t} /></div>
                </div>
              </li>;
            })}
          </ol>
          <div className="story-ownership-panels">
            {chapters.map((chapter) => {
              const cloudModels = chapter === 'models' && showCloud;
              const homeChat = chapter === 'continuity' && continuityApp === 'home';
              const homeWindow = chapter === 'models' || homeChat;
              const title = t(homeChat ? 'experience.homeChatWindow' : cloudModels ? 'experience.cloudModelsWindow' : `experience.${chapter}Window`);
              const open = () => {
                if (homeChat) onHome('chat', partnerId);
                else if (cloudModels) onHome('cloud', cloudCatalog);
                else if (chapter === 'models') onHome('runtime', localCapability);
                else openPreview('nimi.zhiyu', chapter === 'memory' ? 'memory' : 'companion', partnerId);
              };
              return <article key={chapter} className="story-ownership-panel" id={panelId(chapter)}
                data-ownership-chapter={chapter} data-active={activeChapter === chapter} data-hash-target={stepId(chapter)}
                aria-labelledby={`${panelId(chapter)}-heading`}>
                <div className="story-ownership-panel-heading">
                  <h3 id={`${panelId(chapter)}-heading`}>{t(`experience.${chapter}Title`)}</h3>
                  <ChapterSummary chapter={chapter} t={t} />
                </div>
                {chapter === 'continuity' && <SegmentedControl
                  className="story-ownership-switch"
                  ariaLabel={t('experience.switchApp')}
                  size="sm"
                  items={[
                    { value: 'zhiyu', label: t('experience.zhiyuApp'), icon: <img src="/demo/zhiyu-icon.png" alt="" /> },
                    { value: 'home', label: t('hero.homeEyebrow'), icon: <img src="/logo.svg" alt="" /> },
                  ]}
                  value={continuityApp}
                  onValueChange={setContinuityApp}
                />}
                <div className={`hero-demo-frame story-ownership-window${homeWindow ? ' demo-home-frame' : ''}`}>
                  <DemoWindowHeader title={title} iconSrc={homeWindow ? '/logo.svg' : '/demo/zhiyu-icon.png'}>
                    <button type="button" className="story-ownership-open" onClick={open}
                      aria-label={`${t('experience.expand')} · ${title}`}>{t('experience.expand')}<ArrowUpRight size={15} aria-hidden="true" /></button>
                  </DemoWindowHeader>
                  <div className="story-ownership-window-wrap">
                    <div className="story-ownership-window-body" aria-hidden="true" inert>
                      {mountedChapters.has(chapter) ? (
                        <Suspense fallback={<div className="story-ownership-loading">{t('common.loading')}</div>}>
                          {chapter === 'models'
                            ? cloudModels
                              ? <CloudModels demo={demo} target={cloudCatalog} />
                              : <LocalModels demo={demo} initialCapability={localCapability} onNavigate={onHome} />
                            : homeChat
                              ? <HomeChat targetId={partnerId} />
                              : <AppPreviewLocaleProvider locale={preview.locale} messages={preview.messages}>
                                <Zhiyu key={partnerId} content={preview.zhiyu} initialPartnerId={partnerId}
                                  initialPanel={chapter === 'memory' ? 'cognition' : undefined} />
                              </AppPreviewLocaleProvider>}
                        </Suspense>
                      ) : (
                        <div className="story-ownership-loading">{t('common.loading')}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="story-ownership-preview-trigger"
                      onClick={open}
                      aria-label={`${t('experience.expand')} · ${title}`}
                    >
                      <span className="story-ownership-preview-pill">
                        {t('experience.clickHint')}
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </span>
                    </button>
                  </div>
                </div>
                {chapter === 'memory' && <p className="story-ownership-note">{t('experience.memoryNote')}</p>}
              </article>;
            })}
          </div>
        </div>
      </div>
    </div>
  </section>;
}

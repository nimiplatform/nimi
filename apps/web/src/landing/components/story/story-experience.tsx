import { lazy, startTransition, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { SegmentedControl } from '@nimiplatform/kit/ui';
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
const localCapability = 'text.generate';
const cloudCatalog = 'catalog';
const panelId = (chapter: typeof chapters[number]) => `ownership-${chapter}`;

export function findActiveOwnershipChapter(centers: readonly number[], readingLine: number) {
  let current = 0;
  for (const [index, center] of centers.entries()) {
    if (center > readingLine) break;
    current = index;
  }
  return current;
}

export function StoryExperience({ t, partnerId, onHome }: {
  t: StoryText;
  partnerId: string;
  onHome: DemoNavigate;
}) {
  const { demo, openPreview } = useHeroDemoSession();
  const preview = demo.appPreview;
  const copies = useRef<HTMLOListElement>(null);
  const panels = useRef<HTMLDivElement>(null);
  const [activeChapter, setActiveChapter] = useState<typeof chapters[number]>('models');
  const [mountedChapters, setMountedChapters] = useState<ReadonlySet<typeof chapters[number]>>(
    () => new Set(['models']),
  );
  const [showCloud, setShowCloud] = useState(false);
  const [continuityApp, setContinuityApp] = useState('zhiyu');
  const pinnedChapterRef = useRef<{ chapter: typeof chapters[number]; scrollY: number } | null>(null);

  const lockChapter = (chapter: typeof chapters[number]) => {
    setActiveChapter(chapter);
    if (typeof window !== 'undefined') {
      pinnedChapterRef.current = { chapter, scrollY: window.scrollY };
    }
  };

  useEffect(() => {
    setMountedChapters((current) => {
      if (current.has(activeChapter)) return current;
      const next = new Set(current);
      next.add(activeChapter);
      return next;
    });
  }, [activeChapter]);

  useEffect(() => {
    const track = copies.current;
    const stage = panels.current;
    if (!track || !stage) return;
    const items = [...track.querySelectorAll<HTMLElement>('[data-ownership-copy]')];
    const desktop = window.matchMedia('(min-width: 861px) and (min-height: 600px)');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!desktop.matches) {
        setShowCloud(false);
        setMountedChapters(new Set(chapters));
        return;
      }
      if (document.querySelector('[role="dialog"]')) {
        return;
      }
      const pinned = pinnedChapterRef.current;
      if (pinned) {
        if (Math.abs(window.scrollY - pinned.scrollY) < 160) {
          setActiveChapter(pinned.chapter);
          return;
        }
        pinnedChapterRef.current = null;
      }
      const centers = items.map(item => {
        const rect = item.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      const readingLine = Math.max(160, window.innerHeight * 0.65);
      setActiveChapter(chapters[findActiveOwnershipChapter(centers, readingLine)]!);

      // Measure the first chapter from the sticky preview's arrival to the memory handoff.
      const modelsStart = track.getBoundingClientRect().top - Number.parseFloat(window.getComputedStyle(stage).top);
      const modelsEnd = centers[1]! - readingLine;
      const cloudSwitchPoint = modelsStart + (modelsEnd - modelsStart) * 0.4;
      startTransition(() => setShowCloud(cloudSwitchPoint <= 0));
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
        <ol className="story-ownership-index" aria-label={t('experience.title')} ref={copies}>
          {chapters.map((chapter, index) => {
            const copyId = `${panelId(chapter)}-copy`;
            return <li key={chapter} data-active={activeChapter === chapter}>
              <div className="story-ownership-copy" id={copyId} data-ownership-copy={chapter}>
                <a
                  href={`#${panelId(chapter)}`}
                  aria-current={activeChapter === chapter ? 'location' : undefined}
                  onClick={() => lockChapter(chapter)}
                >
                  <span className="story-ownership-number">0{index + 1}</span>
                  <span>{t(`experience.${chapter}Title`)}</span>
                </a>
                <div className="story-ownership-summary"><p>{t(`experience.${chapter}Body`)}</p></div>
              </div>
            </li>;
          })}
        </ol>
        <div className="story-ownership-panels" ref={panels}>
          {chapters.map((chapter, index) => {
            const cloudModels = chapter === 'models' && showCloud;
            const homeChat = chapter === 'continuity' && continuityApp === 'home';
            const homeWindow = chapter === 'models' || homeChat;
            const title = t(homeChat ? 'experience.homeChatWindow' : cloudModels ? 'experience.cloudModelsWindow' : `experience.${chapter}Window`);
            const open = () => {
              lockChapter(chapter);
              if (homeChat) onHome('chat', partnerId);
              else if (cloudModels) onHome('cloud', cloudCatalog);
              else if (chapter === 'models') onHome('runtime', localCapability);
              else openPreview('nimi.zhiyu', chapter === 'memory' ? 'memory' : 'companion', partnerId);
            };
            return <article key={chapter} className="story-ownership-panel" id={panelId(chapter)}
              data-ownership-chapter={chapter} data-active={activeChapter === chapter} data-hash-target={`${panelId(chapter)}-copy`}
              aria-labelledby={`${panelId(chapter)}-heading`}>
              <div className="story-ownership-panel-heading">
                <span className="story-ownership-number">0{index + 1}</span>
                <h3 id={`${panelId(chapter)}-heading`}>{t(`experience.${chapter}Title`)}</h3>
                <p>{t(`experience.${chapter}Body`)}</p>
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
                onValueChange={(value) => {
                  lockChapter('continuity');
                  setContinuityApp(value);
                }}
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
      <p className="story-ownership-scope">{t('experience.scope')}</p>
    </div>
  </section>;
}

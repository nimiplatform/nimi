import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { StoryText } from '../../content/story-copy.js';
import { AppPreviewLocaleProvider } from '../../i18n/app-preview-locale.js';
import type { DemoNavigate } from '../demo-home.js';
import { DemoWindowHeader } from '../demo-window-header.js';
import { useHeroDemoSession } from '../hero-demo-context.js';
import { StoryHeading } from './story-shared.js';

const LocalModels = lazy(async () => ({ default: (await import('../demo-runtime.js')).DemoRuntimeSurface }));
const Zhiyu = lazy(async () => ({ default: (await import('../demo-zhiyu-preview.js')).DemoZhiyuPreview }));
const chapters = ['models', 'memory', 'continuity'] as const;
const localCapability = 'text.generate';
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
  const [activeChapter, setActiveChapter] = useState<typeof chapters[number]>('models');

  useEffect(() => {
    const track = copies.current;
    if (!track) return;
    const items = [...track.querySelectorAll<HTMLElement>('[data-ownership-copy]')];
    const desktop = window.matchMedia('(min-width: 861px) and (min-height: 700px)');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!desktop.matches) return;
      const centers = items.map(item => {
        const rect = item.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      const readingLine = Math.max(160, window.innerHeight * 0.55);
      setActiveChapter(chapters[findActiveOwnershipChapter(centers, readingLine)]!);
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
                <a href={`#${panelId(chapter)}`} aria-current={activeChapter === chapter ? 'location' : undefined}>
                  <span className="story-ownership-number">0{index + 1}</span>
                  <span>{t(`experience.${chapter}Title`)}</span>
                </a>
                <div className="story-ownership-summary"><p>{t(`experience.${chapter}Body`)}</p></div>
              </div>
            </li>;
          })}
        </ol>
        <div className="story-ownership-panels">
          {chapters.map((chapter, index) => {
            const title = t(`experience.${chapter}Window`);
            const open = () => {
              if (chapter === 'models') onHome('runtime', localCapability);
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
              <div className={`hero-demo-frame story-ownership-window${chapter === 'models' ? ' demo-home-frame' : ''}`}>
                <DemoWindowHeader title={title} iconSrc={chapter === 'models' ? '/logo.svg' : '/demo/zhiyu-icon.png'}>
                  <button type="button" className="story-ownership-open" onClick={open}
                    aria-label={`${t('experience.expand')} · ${title}`}>{t('experience.expand')}<ArrowUpRight size={15} aria-hidden="true" /></button>
                </DemoWindowHeader>
                <div className="story-ownership-window-body" aria-hidden="true" inert>
                  <Suspense fallback={<div className="story-ownership-loading">{t('common.loading')}</div>}>
                    {chapter === 'models'
                      ? <LocalModels demo={demo} initialCapability={localCapability} onNavigate={onHome} />
                      : <AppPreviewLocaleProvider locale={preview.locale} messages={preview.messages}>
                        <Zhiyu key={partnerId} content={preview.zhiyu} initialPartnerId={partnerId}
                          initialPanel={chapter === 'memory' ? 'cognition' : undefined} />
                      </AppPreviewLocaleProvider>}
                  </Suspense>
                </div>
              </div>
              {chapter === 'memory' && <p className="story-ownership-note">{t('experience.memoryNote')}</p>}
              {chapter === 'continuity' && <button type="button" onClick={() => onHome('chat', partnerId)} className="story-link story-ownership-related">{t('experience.homeChat')}<ArrowUpRight size={14} aria-hidden="true" /></button>}
            </article>;
          })}
        </div>
      </div>
      <p className="story-ownership-scope">{t('experience.scope')}</p>
    </div>
  </section>;
}

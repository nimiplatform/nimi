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

export function StoryExperience({ t, partnerId, onHome }: {
  t: StoryText;
  partnerId: string;
  onHome: DemoNavigate;
}) {
  const { demo, openPreview } = useHeroDemoSession();
  const preview = demo.appPreview;
  const panels = useRef<HTMLDivElement>(null);
  const [activeChapter, setActiveChapter] = useState<typeof chapters[number]>('models');

  useEffect(() => {
    const track = panels.current;
    if (!track) return;
    const items = [...track.querySelectorAll<HTMLElement>('[data-ownership-chapter]')];
    let frame = 0;
    const update = () => {
      frame = 0;
      // Read the chapter that has reached the upper part of the viewport.
      const readingLine = Math.max(128, window.innerHeight * 0.38);
      let current = 0;
      for (const [index, item] of items.entries()) {
        if (item.getBoundingClientRect().top > readingLine) break;
        current = index;
      }
      setActiveChapter(chapters[current]!);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return <section className="story-section story-experience" id="apps" aria-labelledby="experience-heading">
    <div className="story-container story-experience-container">
      <div className="story-experience-intro">
        <StoryHeading t={t} section="experience" />
        <small>{t('experience.demoLabel')}</small>
      </div>
      <div className="story-experience-composition">
        <ol className="story-ownership-index" aria-label={t('experience.title')}>
          {chapters.map((chapter, index) => <li key={chapter} data-active={activeChapter === chapter}>
            <a href={`#${panelId(chapter)}`} aria-current={activeChapter === chapter ? 'location' : undefined}>
              <span className="story-ownership-number">0{index + 1}</span>
              <span>{t(`experience.${chapter}Title`)}</span>
            </a>
            <div className="story-ownership-summary"><p>{t(`experience.${chapter}Body`)}</p></div>
          </li>)}
        </ol>
        <div className="story-ownership-panels" ref={panels}>
          {chapters.map((chapter, index) => {
            const title = t(`experience.${chapter}Window`);
            const open = () => {
              if (chapter === 'models') onHome('runtime', localCapability);
              else openPreview('nimi.zhiyu', chapter === 'memory' ? 'memory' : 'companion', partnerId);
            };
            return <article key={chapter} className="story-ownership-panel" id={panelId(chapter)}
              data-ownership-chapter={chapter} data-active={activeChapter === chapter} aria-labelledby={`${panelId(chapter)}-heading`}>
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
              {chapter === 'models' && <a href="#models" className="story-link story-ownership-related">{t('experience.modelsLink')}<ArrowUpRight size={14} aria-hidden="true" /></a>}
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

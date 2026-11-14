import { useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { getExploreWorlds } from '../../content/explore-demo-data.js';
import { galleryDragSelection, wrapGalleryIndex } from '../../content/story-model.js';
import type { StoryText } from '../../content/story-copy.js';
import { exploreTopics } from '../demo-explore.js';
import { StoryHeading } from './story-shared.js';

export function StoryWorlds({ t, onOpenWorld, locale }: { locale: 'zh' | 'en'; t: StoryText; onOpenWorld: (worldId: string) => void }) {
  const [index, setIndex] = useState(4);
  const [offset, setOffset] = useState(0);
  const reel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const exploreWorlds = getExploreWorlds(locale);
  const world = exploreWorlds[index]!;
  const selectIndex = (next: number) => { setIndex(wrapGalleryIndex(next, exploreWorlds.length)); setOffset(0); };
  const openWorld = () => onOpenWorld(world.id);
  return <section className="story-section story-worlds" id="worlds" aria-labelledby="worlds-heading" data-story-scene>
    <img key={world.id} className="story-world-atmosphere" src={world.image} alt="" loading="lazy" />
    <div className="story-container"><StoryHeading t={t} section="worlds" /></div>
    <div className="story-world-reel" id="story-world-reel" ref={reel} data-dragging={drag.current?.active || undefined} tabIndex={0} role="region" aria-label={t('worlds.title')}
      onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); selectIndex(index + (e.key === 'ArrowLeft' ? -1 : 1)); reel.current?.focus({ preventScroll: true }); } if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); openWorld(); } }}
      onPointerDown={e => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, active: false }; }}
      onPointerMove={e => {
        const current = drag.current; if (!current) return;
        const dx = e.clientX - current.x, dy = e.clientY - current.y;
        if (!current.active && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { current.active = true; e.currentTarget.setPointerCapture(e.pointerId); }
        if (current.active) { e.preventDefault(); setOffset(Math.max(-450, Math.min(450, dx))); }
      }}
      onPointerUp={e => {
        if (drag.current?.active) { suppressClick.current = true; selectIndex(galleryDragSelection(index, e.clientX - drag.current.x, e.currentTarget.clientWidth, exploreWorlds.length)); window.setTimeout(() => { suppressClick.current = false; }, 0); }
        drag.current = null; setOffset(0);
      }} onPointerCancel={() => { drag.current = null; setOffset(0); }}
      onClickCapture={e => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } }}>
      {[-2, -1, 0, 1, 2].map(position => {
        const item = exploreWorlds[wrapGalleryIndex(index + position, exploreWorlds.length)]!;
        return <button key={item.id} type="button" className={`story-world-print ${position === 0 ? 'is-front' : ''}`} tabIndex={position === 0 ? 0 : -1}
          aria-label={`${t('worlds.open')} · ${item.name}`} aria-pressed={position === 0}
          style={{ '--reel-position': position, '--reel-distance': Math.abs(position), '--reel-drag': `${offset * 0.5}px` } as CSSProperties}
          aria-haspopup={position === 0 ? 'dialog' : undefined}
          onClick={() => position === 0 ? openWorld() : selectIndex(index + position)}>
          <img src={item.image} alt="" draggable={false} loading="lazy" />
          <span><small>{item.topics.map(id => { const topic = exploreTopics.find(topic => topic.id === id)!; return locale === 'zh' ? topic.zh : topic.en; }).join(' · ')}</small><strong>{item.name}</strong><ChevronRight size={22} /></span>
        </button>;
      })}
      <button type="button" className="story-app-showcase-arrow story-app-showcase-arrow--previous"
        aria-label={t('common.previous')} aria-controls="story-world-reel" onClick={() => selectIndex(index - 1)}><ChevronLeft size={22} /></button>
      <button type="button" className="story-app-showcase-arrow story-app-showcase-arrow--next"
        aria-label={t('common.next')} aria-controls="story-world-reel" onClick={() => selectIndex(index + 1)}><ChevronRight size={22} /></button>
    </div>
    <div className="story-container">
      <div className="story-world-caption" aria-live="polite"><div><small>{t('worlds.selectedWorld')} · {String(index + 1).padStart(2, '0')} / {String(exploreWorlds.length).padStart(2, '0')}</small><h3>{world.name}</h3></div><p>{world.description ?? world.summary}</p><div className="story-world-preview-people" aria-hidden="true">{world.people.map(person => <img key={person.id} src={person.image} alt="" />)}</div><button className="story-button" type="button" aria-haspopup="dialog" onClick={openWorld}>{t('worlds.open')}<ArrowRight size={16} /></button></div>

    </div>
  </section>;
}

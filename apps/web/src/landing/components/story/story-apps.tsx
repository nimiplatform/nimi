import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { StoryText } from '../../content/story-copy.js';
import { wrapGalleryIndex } from '../../content/story-model.js';
import { useHeroDemoSession } from '../hero-demo-context.js';
import { AppArtworkIcon } from '../demo-apps.js';
import { StoryHeading } from './story-shared.js';

const ROTATION_INTERVAL_MS = 5000;
const TRACK_SPEED_PX_PER_SECOND = 40;

export function StoryApps({ t, onApp }: { t: StoryText; onApp: (id: string) => void }) {
  const { demo, preview } = useHeroDemoSession();
  const apps = demo.apps.items;
  const locale = demo.appPreview.locale;
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const trackCopyRef = useRef<HTMLDivElement>(null);
  const rotationRemainingRef = useRef(ROTATION_INTERVAL_MS);
  const rotationStartedAtRef = useRef<number | null>(null);
  const [columns, setColumns] = useState(3);
  const [visibleCards, setVisibleCards] = useState<ReadonlySet<string> | null>(null);
  const [position, setPosition] = useState<{ start: number; previous: number | null; direction: number }>({
    start: 0, previous: null, direction: 1,
  });
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const rotating = !reducedMotion && !hovered && !focused && inView && pageVisible && !preview;

  useEffect(() => {
    const extraWide = window.matchMedia('(min-width: 2200px)');
    const wide = window.matchMedia('(min-width: 1280px)');
    const medium = window.matchMedia('(min-width: 650px)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateColumns = () => setColumns(extraWide.matches ? 5 : wide.matches ? 4 : medium.matches ? 3 : 1);
    const updateMotion = () => {
      setReducedMotion(motion.matches);
      if (motion.matches) setPosition(current => ({ ...current, previous: null }));
    };
    const updateVisibility = () => setPageVisible(!document.hidden);
    const observer = new IntersectionObserver(([entry]) => setInView(entry!.isIntersecting));
    observer.observe(viewportRef.current!);
    updateColumns();
    updateMotion();
    updateVisibility();
    extraWide.addEventListener('change', updateColumns);
    wide.addEventListener('change', updateColumns);
    medium.addEventListener('change', updateColumns);
    motion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      observer.disconnect();
      extraWide.removeEventListener('change', updateColumns);
      wide.removeEventListener('change', updateColumns);
      medium.removeEventListener('change', updateColumns);
      motion.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    const copy = trackCopyRef.current;
    if (!track || !copy) return;
    const updateDuration = () => {
      const width = copy.getBoundingClientRect().width;
      if (width > 0) track.style.setProperty('--showcase-loop-duration', `${width / TRACK_SPEED_PX_PER_SECOND}s`);
    };
    const observer = new ResizeObserver(updateDuration);
    observer.observe(copy);
    updateDuration();
    return () => observer.disconnect();
  }, [columns]);

  useEffect(() => {
    const viewport = viewportRef.current!;
    // Either copy can enter the viewport. Keep clipped cards out of the tab order.
    const observer = new IntersectionObserver(entries => {
      setVisibleCards(current => {
        const visible = new Set(current);
        for (const entry of entries) {
          const slot = (entry.target as HTMLButtonElement).dataset.cardSlot!;
          if (entry.isIntersecting) visible.add(slot);
          else visible.delete(slot);
        }
        return visible;
      });
    }, { root: viewport });
    viewport.querySelectorAll<HTMLButtonElement>('.story-app-showcase-card').forEach(card => observer.observe(card));
    return () => observer.disconnect();
  }, [columns]);

  const move = useCallback((direction: -1 | 1) => {
    rotationRemainingRef.current = ROTATION_INTERVAL_MS;
    rotationStartedAtRef.current = null;
    setPosition(current => ({
      start: wrapGalleryIndex(current.start + direction * columns, apps.length),
      previous: reducedMotion ? null : current.start,
      direction,
    }));
  }, [apps.length, columns, reducedMotion]);

  useEffect(() => {
    if (!rotating || position.previous !== null) return;
    rotationStartedAtRef.current = performance.now();
    const timer = window.setTimeout(() => move(1), rotationRemainingRef.current);
    return () => {
      window.clearTimeout(timer);
      const startedAt = rotationStartedAtRef.current;
      if (startedAt === null) return;
      rotationRemainingRef.current = Math.max(0, rotationRemainingRef.current - (performance.now() - startedAt));
      rotationStartedAtRef.current = null;
    };
  }, [move, position.start, position.previous, rotating]);

  const renderTrackCopy = (duplicate: boolean) => {
    const previousStart = position.previous;
    const copy = duplicate ? 'duplicate' : 'primary';
    return <div ref={duplicate ? undefined : trackCopyRef} className="story-app-showcase-track-copy"
      data-track-copy={copy}>
      {Array.from({ length: columns === 1 ? 3 : columns + 1 }, (_, index) => {
        const app = apps[wrapGalleryIndex(position.start + index, apps.length)]!;
        const slot = `${copy}-${index}`;
        const visible = visibleCards?.has(slot) ?? !duplicate;
        const previousApp = previousStart === null ? null : apps[wrapGalleryIndex(previousStart + index, apps.length)]!;
        const renderContent = (item: typeof app, leaving: boolean) => <span key={`${item.id}-${leaving ? 'previous' : 'current'}`}
          className="story-app-showcase-card-content" data-motion={leaving ? 'leave' : previousStart === null ? undefined : 'enter'}
          inert={leaving} aria-hidden={leaving || undefined}
          onAnimationEnd={leaving && !duplicate ? () => setPosition(current => (
            current.previous === previousStart ? { ...current, previous: null } : current
          )) : undefined}>
          <span className="story-app-showcase-card-logo">
            {item.iconSrc
              ? <img src={item.iconSrc} alt="" loading="lazy" decoding="async" />
              : <AppArtworkIcon item={item} size="lg" />}
          </span>
          <img className="story-app-showcase-card-screen" src={`/story/app-previews/${locale}/${item.id}.webp`} alt="" loading="lazy" decoding="async" />
        </span>;
        return <button key={index} type="button" className="story-app-showcase-card"
          data-app-id={app.id} data-card-slot={slot} data-card-width={index % 2 === 0 ? 'wide' : 'narrow'}
          aria-label={`${t('showcase.explore')} · ${app.name}`} aria-haspopup="dialog"
          aria-hidden={!visible || undefined} title={app.name} tabIndex={visible ? undefined : -1} onClick={() => onApp(app.id)}>
          {previousApp && renderContent(previousApp, true)}
          {renderContent(app, false)}
        </button>;
      })}
    </div>;
  };

  return <section id="app-showcase" className="story-section story-app-showcase" aria-labelledby="showcase-heading" data-story-scene>
    <div className="story-container"><StoryHeading t={t} section="showcase" /></div>
    <div className="story-app-showcase-carousel">
      <div id="story-app-showcase-cards" ref={viewportRef} className="story-app-showcase-viewport"
        data-direction={position.direction === 1 ? 'next' : 'previous'}
        data-rotating={rotating}
        aria-live={rotating ? 'off' : 'polite'}
        onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }}
        onPointerLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
        <div ref={trackRef} className="story-app-showcase-track">
          {renderTrackCopy(false)}
          {renderTrackCopy(true)}
        </div>
      </div>
      <div className="story-app-showcase-controls">
        <button type="button" aria-label={t('showcase.previous')} aria-controls="story-app-showcase-cards" onClick={() => move(-1)}>
          <ChevronLeft size={21} aria-hidden="true" />
        </button>
        <button type="button" aria-label={t('showcase.next')} aria-controls="story-app-showcase-cards" onClick={() => move(1)}>
          <ChevronRight size={21} aria-hidden="true" />
        </button>
      </div>
    </div>
  </section>;
}

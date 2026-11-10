import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand } from 'lucide-react';
import type { StoryText } from '../../content/story-copy.js';
import { findCenteredShowcaseIndex, wrapShowcaseIndex } from '../../content/app-showcase.js';
import { useHeroDemoSession } from '../hero-demo-context.js';
import { AppArtworkIcon } from '../demo-apps.js';
import { StoryHeading } from './story-shared.js';

export function StoryApps({ t, onApp }: { t: StoryText; onApp: (id: string) => void }) {
  const session = useHeroDemoSession();
  const apps = session.demo.apps.items;
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [navigation, setNavigation] = useState<{ from: number; to: number; startedAt: number } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const app = apps[selectedIndex] ?? apps[0]!;
  const paused = reducedMotion || hovered || keyboardFocused || !inView || !pageVisible || Boolean(session.preview);

  useEffect(() => {
    const track = trackRef.current;
    const marquee = track?.parentElement;
    if (!track || !marquee) return;
    const logos = Array.from(track.querySelectorAll<HTMLElement>('.story-app-showcase-logo'));
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let lastTime = performance.now();
    let centeredIndex = selectedIndex;
    const updateArc = () => {
      const bounds = marquee.getBoundingClientRect();
      const cycleWidth = track.offsetWidth / 2;
      const step = cycleWidth / apps.length;
      const offset = bounds.width / 2 - logos[0]!.offsetWidth / 2 - positionRef.current * step;
      // Keep both copies covering the viewport, including when navigation wraps.
      track.style.transform = `translateX(${wrapShowcaseIndex(offset, cycleWidth) - cycleWidth}px)`;
      const center = bounds.left + bounds.width / 2;
      const depth = Math.min(150, bounds.width * 0.14);
      // Anchor the controls over the two end slots of the centered logo arc.
      const endSlot = Math.floor(bounds.width / 2 / step);
      const arrowInset = bounds.width / 2 - endSlot * step;
      const arrowArc = (endSlot * step / (bounds.width / 2)) ** 2 * depth;
      const carousel = marquee.parentElement!;
      carousel.style.setProperty('--showcase-arrow-inset', `${arrowInset}px`);
      carousel.style.setProperty('--showcase-arrow-top', `${track.offsetTop + logos[0]!.offsetHeight / 2 + arrowArc}px`);
      const positions = logos.map(logo => logo.getBoundingClientRect());
      logos.forEach((logo, index) => {
        const rect = positions[index]!;
        if (rect.right < bounds.left - rect.width || rect.left > bounds.right + rect.width) return;
        const distance = (rect.left + rect.width / 2 - center) / (bounds.width / 2);
        const arc = Math.min(1, distance * distance) * depth;
        logo.style.setProperty('--logo-arc', `${arc.toFixed(2)}px`);
      });
      if (!paused && !navigation) {
        const nextCenteredIndex = findCenteredShowcaseIndex(positions, bounds, apps.length);
        if (nextCenteredIndex !== null && nextCenteredIndex !== centeredIndex) {
          centeredIndex = nextCenteredIndex;
          setSelectedIndex(nextCenteredIndex);
        }
      }
    };
    const tick = (now: number) => {
      let moving = false;
      if (navigation) {
        const progress = media.matches ? 1 : Math.min(1, (now - navigation.startedAt) / 380);
        const eased = 1 - (1 - progress) ** 3;
        positionRef.current = navigation.from + (navigation.to - navigation.from) * eased;
        moving = progress < 1;
        if (!moving) setNavigation(null);
      } else if (!paused) {
        positionRef.current -= (now - lastTime) * apps.length / 85000;
      }
      lastTime = now;
      updateArc();
      if (!paused || moving) frame = window.requestAnimationFrame(tick);
    };
    tick(lastTime);
    window.addEventListener('resize', updateArc);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateArc);
    };
  }, [apps.length, navigation, paused, selectedIndex]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(media.matches);
    const updateVisibility = () => setPageVisible(!document.hidden);
    const observer = new IntersectionObserver(([entry]) => setInView(entry!.isIntersecting));
    observer.observe(sectionRef.current!);
    media.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  const selectApp = (index: number) => {
    const nextIndex = wrapShowcaseIndex(index, apps.length);
    const from = positionRef.current;
    const distance = wrapShowcaseIndex(nextIndex - from + apps.length / 2, apps.length) - apps.length / 2;
    setSelectedIndex(nextIndex);
    setNavigation({ from, to: from + distance, startedAt: performance.now() });
  };
  const logoGroup = (duplicate: boolean) => <div className="story-app-showcase-logos" aria-hidden={duplicate || undefined}>
    {apps.map((item, index) => <button key={item.id} type="button" className="story-app-showcase-logo"
      data-app-id={item.id} aria-label={item.name} aria-pressed={selectedIndex === index}
      onPointerDown={event => { if (duplicate) event.preventDefault(); }}
      tabIndex={-1} onClick={() => selectApp(index)}>
      <AppArtworkIcon item={item} size="lg" />
      <span className="story-app-showcase-logo-name" aria-hidden="true">{item.name}</span>
    </button>)}
  </div>;

  return <section ref={sectionRef} id="app-showcase" className="story-section story-app-showcase" aria-labelledby="showcase-heading" data-story-scene
    onPointerDownCapture={() => setKeyboardFocused(false)} onKeyDownCapture={() => setKeyboardFocused(true)}
    onFocusCapture={event => setKeyboardFocused(event.target.matches(':focus-visible'))} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyboardFocused(false);
    }}>
    <div className="story-container"><StoryHeading t={t} section="showcase" /></div>
    <div className="story-container story-app-showcase-carousel"
      onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }} onPointerLeave={() => setHovered(false)}>
      <div className="story-app-showcase-marquee" id="story-app-showcase-logos">
        <div ref={trackRef} className="story-app-showcase-track">
          {logoGroup(false)}
          {logoGroup(true)}
        </div>
      </div>
      <button type="button" className="story-app-showcase-arrow story-app-showcase-arrow--previous"
        aria-label={t('showcase.previous')} aria-controls="story-app-showcase-logos" onClick={() => selectApp(selectedIndex - 1)}><ChevronLeft size={22} /></button>
      <button type="button" className="story-app-showcase-arrow story-app-showcase-arrow--next"
        aria-label={t('showcase.next')} aria-controls="story-app-showcase-logos" onClick={() => selectApp(selectedIndex + 1)}><ChevronRight size={22} /></button>
    </div>
    <div className="story-container story-app-showcase-content">
      <div className="story-app-showcase-copy" aria-live={paused ? 'polite' : 'off'} aria-atomic="true"
        onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }} onPointerLeave={() => setHovered(false)}>
        <h3>{app.name}</h3>
        <p>{app.task}</p>
        <button type="button" className="story-button" onClick={() => onApp(app.id)}><Expand size={17} />{t('showcase.explore')}</button>
      </div>
    </div>
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, Pause, Play } from 'lucide-react';
import type { StoryText } from '../../content/story-copy.js';
import { wrapShowcaseIndex } from '../../content/app-showcase.js';
import { useHeroDemoSession } from '../hero-demo-context.js';
import { AppArtworkIcon } from '../demo-apps.js';
import { StoryHeading } from './story-shared.js';

export function StoryApps({ t, onApp }: { t: StoryText; onApp: (id: string) => void }) {
  const session = useHeroDemoSession();
  const apps = session.demo.apps.items;
  const trackRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, apps.findIndex(item => item.id === 'ai.nimi.videolingo')));
  const [playing, setPlaying] = useState(() => typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const app = apps[selectedIndex] ?? apps[0]!;
  const paused = !playing || hovered || focused || Boolean(session.preview);

  useEffect(() => {
    const track = trackRef.current;
    const marquee = track?.parentElement;
    if (!track || !marquee) return;
    const logos = Array.from(track.querySelectorAll<HTMLElement>('.story-app-showcase-logo'));
    let frame = 0;
    const updateArc = () => {
      const bounds = marquee.getBoundingClientRect();
      const center = bounds.left + bounds.width / 2;
      const depth = Math.min(150, bounds.width * 0.14);
      const positions = logos.map(logo => logo.getBoundingClientRect());
      logos.forEach((logo, index) => {
        const rect = positions[index]!;
        if (rect.right < bounds.left - rect.width || rect.left > bounds.right + rect.width) return;
        const distance = (rect.left + rect.width / 2 - center) / (bounds.width / 2);
        const arc = Math.min(1, distance * distance) * depth;
        logo.style.setProperty('--logo-arc', `${arc.toFixed(2)}px`);
      });
    };
    const tick = () => {
      updateArc();
      if (!paused) frame = window.requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener('resize', updateArc);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateArc);
    };
  }, [apps.length, paused]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pause = () => { if (media.matches) setPlaying(false); };
    media.addEventListener('change', pause);
    return () => media.removeEventListener('change', pause);
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setSelectedIndex(current => wrapShowcaseIndex(current + 1, apps.length));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [apps.length, paused]);

  const selectApp = (index: number) => {
    setPlaying(false);
    setSelectedIndex(wrapShowcaseIndex(index, apps.length));
  };
  const logoGroup = (duplicate: boolean) => <div className="story-app-showcase-logos" aria-hidden={duplicate || undefined}>
    {apps.map((item, index) => <button key={item.id} type="button" className="story-app-showcase-logo"
      data-app-id={item.id} aria-label={item.name} aria-pressed={selectedIndex === index}
      onPointerDown={event => { if (duplicate) event.preventDefault(); }}
      tabIndex={-1} onClick={() => selectApp(index)}>
      <AppArtworkIcon item={item} size="lg" />
    </button>)}
  </div>;

  return <section id="app-showcase" className="story-section story-app-showcase" aria-labelledby="showcase-heading" data-story-scene
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    }}>
    <div className="story-container"><StoryHeading t={t} section="showcase" /></div>
    <div className="story-app-showcase-controls">
      <button type="button" aria-label={t('showcase.previous')} onClick={() => selectApp(selectedIndex - 1)}><ChevronLeft size={18} /></button>
      <button type="button" onClick={() => setPlaying(current => !current)}>{playing ? <Pause size={16} /> : <Play size={16} />}{t(playing ? 'showcase.pause' : 'showcase.play')}</button>
      <button type="button" aria-label={t('showcase.next')} onClick={() => selectApp(selectedIndex + 1)}><ChevronRight size={18} /></button>
    </div>
    <div className="story-container story-app-showcase-marquee">
      <div ref={trackRef} className={`story-app-showcase-track${paused ? ' is-paused' : ''}`}>
        {logoGroup(false)}
        {logoGroup(true)}
      </div>
    </div>
    <div className="story-container story-app-showcase-content">
      <div className="story-app-showcase-copy" key={app.id} aria-live={paused ? 'polite' : 'off'} aria-atomic="true">
        <h3>{app.name}</h3>
        <p>{app.task}</p>
        <button type="button" className="story-button" onClick={() => onApp(app.id)}><Expand size={17} />{t('showcase.explore')}</button>
      </div>
    </div>
  </section>;
}

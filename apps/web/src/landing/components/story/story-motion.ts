import { useEffect, useLayoutEffect, type RefObject } from 'react';

export function useStoryHeroMotion(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const hero = root.current;
    const stage = hero?.querySelector<HTMLElement>('.story-hero-stage');
    const dock = stage?.querySelector<HTMLElement>('.story-home-dock');
    if (!hero || !stage || !dock) return;
    const motion = window.matchMedia('(prefers-reduced-motion: no-preference) and (min-height: 520px)');
    let frame = 0;
    let arrival = 0;
    let openingEdge = 0;
    let settled = false;

    const clearReveal = () => {
      hero.style.removeProperty('--hero-depth');
      hero.style.removeProperty('--hero-reveal-end');
      stage.style.removeProperty('--hero-stage-reveal');
    };

    const paint = () => {
      frame = 0;
      const remaining = 1 - Math.min(1, Math.max(0, window.scrollY / arrival));
      if (remaining === 0) {
        if (!settled) clearReveal();
        settled = true;
        return;
      }
      settled = false;
      // Open the crop below the viewport by the time the dock reaches full size.
      const edge = openingEdge * remaining + window.innerHeight * 1.01 * (1 - remaining);
      const heroTop = hero.getBoundingClientRect().top;
      const stageTop = stage.getBoundingClientRect().top;
      hero.style.setProperty('--hero-depth', String(remaining ** 2));
      hero.style.setProperty('--hero-reveal-end', `${edge - heroTop}px`);
      stage.style.setProperty('--hero-stage-reveal', `${edge - stageTop}px`);
    };
    const schedule = () => { if (!frame && motion.matches) frame = window.requestAnimationFrame(paint); };
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      if (!motion.matches) {
        clearReveal();
        return;
      }
      const style = window.getComputedStyle(dock);
      const stageTop = stage.getBoundingClientRect().top + window.scrollY;
      const lift = Number.parseFloat(style.getPropertyValue('--hero-lift'));
      const scale = 1 - Number.parseFloat(style.getPropertyValue('--hero-scale-loss'));
      arrival = Math.max(1, stageTop - Number.parseFloat(style.top));
      openingEdge = Math.min(window.innerHeight * .94, stageTop + lift + dock.offsetHeight * scale * .9);
      paint();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(hero);
    measure();
    motion.addEventListener('change', measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', schedule);
      window.cancelAnimationFrame(frame);
      clearReveal();
    };
  }, [root]);
}

export function useStoryMotion(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const site = root.current;
    if (!site || typeof IntersectionObserver === 'undefined') return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let dispose = () => {};
    const configure = () => {
      dispose();
      if (preference.matches) return;
      const scenes = [...site.querySelectorAll<HTMLElement>('[data-story-scene]')];
      const visible = new Set<HTMLElement>();
      let frame = 0;
      const paint = () => {
        frame = 0;
        for (const scene of visible) {
          const rect = scene.getBoundingClientRect();
          const progress = Math.max(-1, Math.min(1, (window.innerHeight / 2 - rect.top - rect.height / 2) / window.innerHeight));
          scene.style.setProperty('--scene-shift', `${progress * 32}px`);
        }
      };
      const schedule = () => { if (!frame) frame = window.requestAnimationFrame(paint); };
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const scene = entry.target as HTMLElement;
          if (entry.isIntersecting) { visible.add(scene); scene.dataset.entered = 'true'; }
          else visible.delete(scene);
        }
        schedule();
      }, { threshold: 0.06 });
      site.dataset.motion = 'ready';
      scenes.forEach(scene => observer.observe(scene));
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      dispose = () => {
        observer.disconnect();
        window.cancelAnimationFrame(frame);
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
        delete site.dataset.motion;
        scenes.forEach(scene => scene.style.removeProperty('--scene-shift'));
      };
    };
    configure();
    preference.addEventListener('change', configure);
    return () => { dispose(); preference.removeEventListener('change', configure); };
  }, [root]);
}

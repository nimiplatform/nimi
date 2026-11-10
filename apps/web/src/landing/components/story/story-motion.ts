import { useEffect, type RefObject } from 'react';

/** Scroll moves the scenery and Home window without taking over navigation or demo state. */
export function useStoryMotion(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const site = root.current;
    if (!site) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let dispose = () => {};
    const configure = () => {
      dispose();
      if (preference.matches) return;
      const hero = site.querySelector<HTMLElement>('.story-hero');
      const homeStage = hero?.querySelector<HTMLElement>('.story-home-stage');
      const home = homeStage?.querySelector<HTMLElement>('#home-demo');
      const scenes = [...site.querySelectorAll<HTMLElement>('[data-story-scene]')];
      const visible = new Set<HTMLElement>();
      let frame = 0;
      let remainingDepth: number | undefined;
      const paint = () => {
        frame = 0;
        if (hero && homeStage && home) {
          // Reach full size exactly where the dock reaches its sticky position.
          const style = window.getComputedStyle(home);
          const stageTop = homeStage.getBoundingClientRect().top;
          const remaining = stageTop - Number.parseFloat(style.top);
          const scroll = Math.max(0, window.scrollY);
          const distance = remaining > 0 ? remaining / (remaining + scroll) : 0;
          const depth = distance ** 2;
          if (distance > 0) {
            const openingTop = stageTop + scroll + Number.parseFloat(style.getPropertyValue('--hero-lift'));
            const openingScale = 1 - Number.parseFloat(style.getPropertyValue('--hero-scale-loss'));
            const openingEdge = Math.min(window.innerHeight * 0.925, openingTop + home.offsetHeight * openingScale * 0.64);
            // Move the cut below the viewport before handing off to the hold.
            const edge = openingEdge * distance + window.innerHeight * 1.01 * (1 - distance);
            hero.style.setProperty('--hero-reveal-end', `${edge - hero.getBoundingClientRect().top}px`);
          } else if (remainingDepth) {
            hero.style.removeProperty('--hero-reveal-end');
          }
          if (depth !== remainingDepth) {
            remainingDepth = depth;
            if (depth > 0) home.style.setProperty('--hero-depth', String(depth));
            else home.style.removeProperty('--hero-depth');
          }
        }
        for (const scene of visible) {
          const rect = scene.getBoundingClientRect();
          const progress = Math.max(-1, Math.min(1, (window.innerHeight / 2 - rect.top - rect.height / 2) / window.innerHeight));
          scene.style.setProperty('--scene-shift', `${progress * 32}px`);
        }
      };
      const schedule = () => { if (!frame) frame = window.requestAnimationFrame(paint); };
      const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
        for (const entry of entries) {
          const scene = entry.target as HTMLElement;
          if (entry.isIntersecting) { visible.add(scene); scene.dataset.entered = 'true'; }
          else visible.delete(scene);
        }
        schedule();
      }, { threshold: 0.06 });
      if (observer) {
        site.dataset.motion = 'ready';
        scenes.forEach(scene => observer.observe(scene));
      }
      paint();
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      dispose = () => {
        observer?.disconnect();
        window.cancelAnimationFrame(frame);
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
        delete site.dataset.motion;
        hero?.style.removeProperty('--hero-reveal-end');
        home?.style.removeProperty('--hero-depth');
        scenes.forEach(scene => scene.style.removeProperty('--scene-shift'));
      };
    };
    configure();
    preference.addEventListener('change', configure);
    return () => { dispose(); preference.removeEventListener('change', configure); };
  }, [root]);
}

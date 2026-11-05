import { useEffect, type RefObject } from 'react';

/** Scroll changes atmosphere only; navigation and the interactive Home own their state. */
export function useStoryMotion(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const site = root.current;
    if (!site) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let dispose = () => {};
    const configure = () => {
      dispose();
      if (preference.matches || !('IntersectionObserver' in window)) return;
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

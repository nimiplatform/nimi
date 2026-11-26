import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export type HeroScreenAnchors = {
  heroTop: number;
  demoScreen: number;
  nextScreen: number;
};

export type HeroScrollRevealState = {
  remaining: number;
  depth: number;
  copyOpacity: number;
  settled: boolean;
};

export function computeHeroScrollReveal(
  scrollY: number,
  arrival: number,
): HeroScrollRevealState {
  const safeArrival = Math.max(1, arrival);
  const progress = Math.min(1, Math.max(0, scrollY / safeArrival));
  const remaining = 1 - progress;
  if (remaining <= 0) {
    return {
      remaining: 0,
      depth: 0,
      copyOpacity: 0,
      settled: true,
    };
  }
  return {
    remaining,
    depth: remaining ** 2,
    copyOpacity: Math.max(0, Math.min(1, (remaining - 0.15) / 0.85)),
    settled: false,
  };
}

export type HeroMotionOptions = {
  onStageActiveChange?: (active: boolean) => void;
};

export function useStoryHeroMotion(
  root: RefObject<HTMLElement | null>,
  options?: HeroMotionOptions,
) {
  const onStageActiveChangeRef = useRef(options?.onStageActiveChange);
  onStageActiveChangeRef.current = options?.onStageActiveChange;

  useLayoutEffect(() => {
    const hero = root.current;
    const stage = hero?.querySelector<HTMLElement>('.story-hero-stage');
    const dock = stage?.querySelector<HTMLElement>('.story-home-dock');
    if (!hero || !stage || !dock) return;
    const motion = window.matchMedia('(prefers-reduced-motion: no-preference) and (min-height: 520px)');
    let frame = 0;
    let arrival = 1;
    let openingEdge = 0;
    let settled = false;
    let stageActive = false;
    let stageActiveTimer = 0;

    const clearReveal = () => {
      hero.style.removeProperty('--hero-depth');
      hero.style.removeProperty('--hero-copy-opacity');
      hero.style.removeProperty('--hero-reveal-end');
      stage.style.removeProperty('--hero-stage-reveal');
    };

    const readAnchors = (): HeroScreenAnchors => {
      const style = window.getComputedStyle(dock);
      const stageTop = stage.getBoundingClientRect().top + window.scrollY;
      const parsedDockTop = Number.parseFloat(style.top);
      const dockTop = Number.isFinite(parsedDockTop)
        ? parsedDockTop
        : (Number.parseFloat(window.getComputedStyle(stage).scrollMarginTop) || 88);
      const demoScreen = Math.max(0, Math.round(stageTop - dockTop));
      const nextSection = hero.nextElementSibling instanceof HTMLElement ? hero.nextElementSibling : null;
      if (!nextSection) {
        return { heroTop: 0, demoScreen, nextScreen: demoScreen };
      }
      const nextTop = nextSection.getBoundingClientRect().top + window.scrollY;
      const heroPaddingBottom = Number.parseFloat(window.getComputedStyle(hero).paddingBottom) || 48;
      const nextOffset = Math.min(28, Math.max(0, heroPaddingBottom - 16));
      const nextScreen = Math.max(demoScreen + 1, Math.round(nextTop - nextOffset));
      return { heroTop: 0, demoScreen, nextScreen };
    };

    const syncStageActive = () => {
      const callback = onStageActiveChangeRef.current;
      if (!callback) return;
      const anchors = readAnchors();
      const scrollY = window.scrollY;
      const isAtDemoScreen =
        anchors.demoScreen > 20
        && scrollY >= anchors.demoScreen - 28
        && scrollY < anchors.nextScreen - 120;
      if (isAtDemoScreen) {
        if (stageActive || stageActiveTimer) return;
        stageActiveTimer = window.setTimeout(() => {
          stageActiveTimer = 0;
          const latest = readAnchors();
          const currentY = window.scrollY;
          if (currentY >= latest.demoScreen - 28 && currentY < latest.nextScreen - 120) {
            stageActive = true;
            onStageActiveChangeRef.current?.(true);
          }
        }, 180);
      } else {
        if (stageActiveTimer) {
          window.clearTimeout(stageActiveTimer);
          stageActiveTimer = 0;
        }
        if (stageActive) {
          stageActive = false;
          callback(false);
        }
      }
    };

    const paint = () => {
      frame = 0;
      syncStageActive();
      if (!motion.matches) return;
      const reveal = computeHeroScrollReveal(window.scrollY, arrival);
      if (reveal.settled) {
        if (!settled) {
          hero.style.removeProperty('--hero-depth');
          hero.style.removeProperty('--hero-reveal-end');
          stage.style.removeProperty('--hero-stage-reveal');
          hero.style.setProperty('--hero-copy-opacity', '0');
        }
        settled = true;
        return;
      }
      settled = false;
      // Open the crop below the viewport by the time the dock reaches full size.
      const edge = openingEdge * reveal.remaining + window.innerHeight * 1.01 * (1 - reveal.remaining);
      const heroTop = hero.getBoundingClientRect().top;
      const stageTop = stage.getBoundingClientRect().top;
      hero.style.setProperty('--hero-depth', String(reveal.depth));
      hero.style.setProperty('--hero-copy-opacity', String(reveal.copyOpacity));
      hero.style.setProperty('--hero-reveal-end', `${edge - heroTop}px`);
      stage.style.setProperty('--hero-stage-reveal', `${edge - stageTop}px`);
    };

    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(paint); };
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      if (!motion.matches) {
        clearReveal();
        syncStageActive();
        return;
      }
      const style = window.getComputedStyle(dock);
      const stageTop = stage.getBoundingClientRect().top + window.scrollY;
      const dockTop = Number.parseFloat(style.top) || 0;
      const lift = Number.parseFloat(style.getPropertyValue('--hero-lift')) || 0;
      const scale = 1 - (Number.parseFloat(style.getPropertyValue('--hero-scale-loss')) || 0);
      arrival = Math.max(1, stageTop - dockTop);
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
      if (stageActiveTimer) window.clearTimeout(stageActiveTimer);
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

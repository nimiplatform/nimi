import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export type HeroScreenAnchors = {
  heroTop: number;
  demoScreen: number;
  nextScreen: number;
};

export function resolveHeroScreenTarget(
  scrollY: number,
  deltaY: number,
  anchors: HeroScreenAnchors,
  tolerance = 14,
): number | null {
  if (deltaY === 0 || anchors.demoScreen <= anchors.heroTop + tolerance) {
    return null;
  }
  const { heroTop, demoScreen, nextScreen } = anchors;
  if (deltaY > 0) {
    if (scrollY < demoScreen - tolerance) return demoScreen;
    if (scrollY < nextScreen - tolerance) return nextScreen;
    return null;
  }
  if (scrollY <= heroTop + 2) return null;
  if (scrollY <= demoScreen + tolerance) return heroTop;
  if (scrollY <= nextScreen + tolerance) return demoScreen;
  return null;
}

function normalizeWheelDeltaY(event: WheelEvent): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * window.innerHeight;
  return event.deltaY;
}

function canScrollableAncestorConsume(
  target: EventTarget | null,
  boundary: HTMLElement,
  deltaY: number,
): boolean {
  if (!(target instanceof Element) || !boundary.contains(target)) return false;
  let node: Element | null = target;
  while (node && node !== boundary) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
      && node.scrollHeight > node.clientHeight + 2
    ) {
      if (deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 2) return true;
      if (deltaY < 0 && node.scrollTop > 2) return true;
    }
    node = node.parentElement;
  }
  return false;
}

const SCROLL_CANCEL_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'PageDown',
  'PageUp',
  'Home',
  'End',
  ' ',
]);

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
    const paging = window.matchMedia('(prefers-reduced-motion: no-preference) and (min-width: 701px) and (min-height: 520px)');
    let frame = 0;
    let arrival = 0;
    let openingEdge = 0;
    let settled = false;
    let scrollAnimFrame = 0;
    let scrollAnimDir = 0;
    let lockedDir = 0;
    let lastWheelAt = 0;
    let lastAbsDelta = 0;
    let innerScrollActive = false;
    let stageActive = false;
    let stageActiveTimer = 0;

    const clearReveal = () => {
      hero.style.removeProperty('--hero-depth');
      hero.style.removeProperty('--hero-copy-opacity');
      hero.style.removeProperty('--hero-reveal-end');
      stage.style.removeProperty('--hero-stage-reveal');
    };

    const cancelScrollAnim = () => {
      if (scrollAnimFrame) {
        window.cancelAnimationFrame(scrollAnimFrame);
        scrollAnimFrame = 0;
      }
      scrollAnimDir = 0;
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
      const remaining = 1 - Math.min(1, Math.max(0, window.scrollY / arrival));
      if (remaining === 0) {
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
      const edge = openingEdge * remaining + window.innerHeight * 1.01 * (1 - remaining);
      const heroTop = hero.getBoundingClientRect().top;
      const stageTop = stage.getBoundingClientRect().top;
      const copyOpacity = Math.max(0, Math.min(1, (remaining - 0.15) / 0.85));
      hero.style.setProperty('--hero-depth', String(remaining ** 2));
      hero.style.setProperty('--hero-copy-opacity', String(copyOpacity));
      hero.style.setProperty('--hero-reveal-end', `${edge - heroTop}px`);
      stage.style.setProperty('--hero-stage-reveal', `${edge - stageTop}px`);
    };

    const animateScrollTo = (targetY: number, dir: number) => {
      cancelScrollAnim();
      const startY = window.scrollY;
      const distance = targetY - startY;
      if (Math.abs(distance) < 1) {
        window.scrollTo(0, targetY);
        paint();
        return;
      }
      const duration = Math.min(600, Math.max(400, Math.abs(distance) * 0.62));
      const startTime = performance.now();
      scrollAnimDir = dir;
      const step = (now: number) => {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = 1 - (1 - progress) ** 3;
        window.scrollTo(0, startY + distance * eased);
        paint();
        if (progress < 1) {
          scrollAnimFrame = window.requestAnimationFrame(step);
        } else {
          scrollAnimFrame = 0;
          scrollAnimDir = 0;
          paint();
        }
      };
      scrollAnimFrame = window.requestAnimationFrame(step);
    };

    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(paint); };
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      if (!motion.matches) {
        cancelScrollAnim();
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

    const onWheel = (event: WheelEvent) => {
      if (!paging.matches || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      const deltaY = normalizeWheelDeltaY(event);
      const absDelta = Math.abs(deltaY);
      if (absDelta < 1 || Math.abs(event.deltaX) > absDelta) return;

      const now = performance.now();
      const dir = deltaY > 0 ? 1 : -1;
      const gap = now - lastWheelAt;
      const prevAbsDelta = lastAbsDelta;
      lastWheelAt = now;
      lastAbsDelta = absDelta;

      if (gap >= 140) {
        lockedDir = 0;
        innerScrollActive = false;
      }

      if (scrollAnimFrame) {
        if (dir !== scrollAnimDir && absDelta >= 6) {
          cancelScrollAnim();
          lockedDir = 0;
        } else {
          event.preventDefault();
          return;
        }
      }

      const anchors = readAnchors();
      const scrollY = window.scrollY;

      if (lockedDir !== 0) {
        const isReversal = dir !== lockedDir;
        const isFreshBurst = !isReversal && absDelta >= 24 && absDelta > prevAbsDelta * 2 + 12;
        if (!isReversal && !isFreshBurst) {
          const inPagingZone = resolveHeroScreenTarget(scrollY, deltaY, anchors) !== null;
          if (inPagingZone || absDelta < 30) {
            event.preventDefault();
            return;
          }
        }
        lockedDir = 0;
      }

      const allowInnerDemoScroll = scrollY >= anchors.demoScreen - 14;
      if (allowInnerDemoScroll) {
        const demoFrame = event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-demo-owns-scroll="true"]')
          : null;
        if (demoFrame && canScrollableAncestorConsume(event.target, demoFrame, deltaY)) {
          innerScrollActive = true;
          return;
        }
        if (innerScrollActive) {
          event.preventDefault();
          return;
        }
      }

      const target = resolveHeroScreenTarget(scrollY, deltaY, anchors);
      if (target === null) return;

      event.preventDefault();
      lockedDir = dir;
      animateScrollTo(target, dir);
    };

    const onUserInterrupt = () => {
      cancelScrollAnim();
      lockedDir = 0;
      innerScrollActive = false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!SCROLL_CANCEL_KEYS.has(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      onUserInterrupt();
    };

    const observer = new ResizeObserver(measure);
    observer.observe(hero);
    measure();
    motion.addEventListener('change', measure);
    paging.addEventListener('change', onUserInterrupt);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onUserInterrupt, { passive: true });
    window.addEventListener('pointerdown', onUserInterrupt, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('hashchange', onUserInterrupt);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', measure);
      paging.removeEventListener('change', onUserInterrupt);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onUserInterrupt);
      window.removeEventListener('pointerdown', onUserInterrupt);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('hashchange', onUserInterrupt);
      window.cancelAnimationFrame(frame);
      if (stageActiveTimer) window.clearTimeout(stageActiveTimer);
      cancelScrollAnim();
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

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { PagingDirection } from './use-section-paging.js';

/**
 * Move the hero preview between the two presentation slots. Both slots share
 * a demo session, so animation only owns geometry; it never navigates the app.
 * The hero node is restored before React changes its expanded layout.
 */
const TRAVEL_MS = 820;
const TOTAL_MS = TRAVEL_MS;
const LOCK_MS = TOTAL_MS + 140;
const WATCHDOG_MS = TOTAL_MS + 700;

const SURFACE_SELECTOR = '[data-demo-surface]';
const GLOW_SELECTOR = '.hero-glow';

type MorphRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpRect(from: MorphRect, to: MorphRect, t: number): MorphRect {
  return {
    left: lerp(from.left, to.left, t),
    top: lerp(from.top, to.top, t),
    width: lerp(from.width, to.width, t),
    height: lerp(from.height, to.height, t),
  };
}

function rectOf(el: HTMLElement): MorphRect {
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function applyRect(wrap: HTMLElement, rect: MorphRect): void {
  wrap.style.left = `${rect.left}px`;
  wrap.style.top = `${rect.top}px`;
  wrap.style.width = `${rect.width}px`;
  wrap.style.height = `${rect.height}px`;
}

export type HeroAppsMorph = {
  /** useSectionPaging onFlip handler; returns the paging lock when it runs. */
  handleFlip: (fromIndex: number, targetIndex: number, direction: PagingDirection) => number | void;
  /** While true, the hero demo renders its height-flexible (expanded) frame. */
  heroDemoExpanded: boolean;
  cancel: () => void;
};

export function useHeroAppsMorph(): HeroAppsMorph {
  const [heroDemoExpanded, setHeroDemoExpanded] = useState(false);
  const animatingRef = useRef(false);
  const watchdogRef = useRef(0);
  const frameRef = useRef(0);
  const restoreRef = useRef<(() => void) | null>(null);

  // Restore React's node before unmount removes its original parent. Also
  // stop the watchdog and frame loop so a retired flight cannot affect a new one.
  useLayoutEffect(() => () => restoreRef.current?.(), []);

  const cancel = useCallback(() => {
    if (!restoreRef.current) return;
    restoreRef.current();
    flushSync(() => {
      setHeroDemoExpanded(false);
    });
  }, []);

  const handleFlip = useCallback(
    (fromIndex: number, targetIndex: number, direction: PagingDirection): number | void => {
      const isHeroAppsPair = (fromIndex === 0 && targetIndex === 1) || (fromIndex === 1 && targetIndex === 0);
      if (!isHeroAppsPair || animatingRef.current) {
        return undefined;
      }
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        return undefined;
      }
      if (
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        return undefined;
      }

      const heroWrap = document.querySelector<HTMLElement>('[data-hero-morph]');
      const appsWrap = document.querySelector<HTMLElement>('[data-apps-morph]');
      const appsSection = document.getElementById('apps');
      const heroCopy = document.querySelector<HTMLElement>('[data-hero-copy]');
      if (!heroWrap || !appsWrap || !appsSection || !heroWrap.parentElement) {
        return undefined;
      }
      // The static fallback keeps the default page flip until the demo loads.
      const departing = direction === 1 ? heroWrap : appsWrap;
      if (!departing.querySelector('[data-demo-interactive="true"]')) {
        return undefined;
      }

      animatingRef.current = true;

      const startScroll = window.scrollY;

      // The flight starts from the window the user is looking at, so the hero
      // slot rect is captured BEFORE the frame becomes height-flexible: the
      // expanded frame drops the fixed hero body heights, and measuring after
      // the flush would capture a collapsed content height — the window would
      // snap to a smaller size on the first painted frame of the gesture. The
      // same rect sizes the placeholder, so the return flight also lands on
      // the exact pre-expansion slot.
      const home = rectOf(heroWrap);

      // Navigation belongs to the shared demo session, including on the return
      // journey. Resizing must not replace its current page or conversation.
      flushSync(() => {
        setHeroDemoExpanded(true);
      });
      // Reparenting a node (appendChild below, replaceWith at the end) removes
      // and re-inserts it, which restarts CSS animations on its subtree: the
      // settled surface would replay its enter fade in the first frames of the
      // lift — a blink on content the user is already looking at. Pin the
      // current surface to its final state before every move; the surface
      // geometry animation must not restart the current surface fade.
      const settleSurface = () => {
        const surface = heroWrap.querySelector<HTMLElement>(SURFACE_SELECTOR);
        if (surface) {
          surface.style.animation = 'none';
        }
      };
      settleSurface();
      // The hero halo travels with the window but the apps window has none, so
      // it fades out over the flight down and back in over the flight up —
      // otherwise it would pop at the handoff frame.
      const glow = heroWrap.querySelector<HTMLElement>(GLOW_SELECTOR);
      if (glow) {
        glow.style.opacity = direction === 1 ? '1' : '0';
      }

      // A placeholder keeps the hero grid cell (no reflow) and reports the
      // slot's live viewport rect for the whole flight.
      const slot = document.createElement('div');
      slot.setAttribute('aria-hidden', 'true');
      slot.style.width = `${home.width}px`;
      slot.style.height = `${home.height}px`;
      heroWrap.after(slot);

      // Lift the window out of the hero section entirely: fixed positioning
      // escapes the section's clip bounds, and reparenting to <body> escapes
      // the hero container's stacking context — otherwise the rising apps
      // section (same z-index, later in DOM) would paint over the window.
      // The node returns to its grid cell before React next renders it.
      const lift = direction === 1 ? home : rectOf(appsWrap);
      heroWrap.style.position = 'fixed';
      heroWrap.style.margin = '0';
      heroWrap.style.zIndex = '30';
      heroWrap.style.pointerEvents = 'none';
      applyRect(heroWrap, lift);
      document.body.appendChild(heroWrap);
      // The real apps window waits out the whole sequence; the traveling window
      // lands on its exact rect and hands over the same page in one frame.
      appsWrap.style.visibility = 'hidden';
      if (heroCopy && direction === -1) {
        heroCopy.style.opacity = '0';
      }

      const restore = () => {
        restoreRef.current = null;
        animatingRef.current = false;
        // Disarm this flight's watchdog: it must not stay
        // live past a clean finish, and once the paging lock releases the NEXT
        // flight can be airborne when a stale timer fires — it would see
        // animatingRef set and run this flight's finish (detached slot, wrong
        // direction scroll), stranding the demo window on <body>.
        window.clearTimeout(watchdogRef.current);
        window.cancelAnimationFrame(frameRef.current);
        settleSurface();
        slot.replaceWith(heroWrap);
        heroWrap.style.position = '';
        heroWrap.style.margin = '';
        heroWrap.style.left = '';
        heroWrap.style.top = '';
        heroWrap.style.width = '';
        heroWrap.style.height = '';
        heroWrap.style.zIndex = '';
        heroWrap.style.pointerEvents = '';
        appsWrap.style.visibility = '';
        if (heroCopy) {
          heroCopy.style.opacity = '';
        }
        if (glow) {
          glow.style.opacity = '';
        }
      };
      restoreRef.current = restore;

      const finish = () => {
        window.scrollTo({ top: direction === 1 ? appsSection.offsetTop : 0, behavior: 'auto' });
        if (direction === 1) appsSection.scrollTop = 0;
        restore();
        // Restore layout and state in the same task, without a collapsed frame.
        flushSync(() => {
          setHeroDemoExpanded(false);
        });
      };

      const t0 = window.performance.now();
      const tick = () => {
        if (!animatingRef.current) {
          return;
        }
        const t = clamp01((window.performance.now() - t0) / TRAVEL_MS);
        const eased = easeInOutCubic(t);
        // Drive the scroll with the live section target: reading it every frame
        // absorbs any layout drift mid-flight.
        const endScroll = direction === 1 ? appsSection.offsetTop : 0;
        window.scrollTo({ top: lerp(startScroll, endScroll, eased), behavior: 'auto' });
        // Progress between the two screens (0 = hero, 1 = apps).
        const p = direction === 1 ? eased : 1 - eased;
        applyRect(heroWrap, lerpRect(rectOf(slot), rectOf(appsWrap), p));
        if (heroCopy) {
          heroCopy.style.opacity = (
            direction === 1 ? clamp01(1 - t / 0.25) : clamp01((t - 0.65) / 0.35)
          ).toFixed(3);
        }
        if (glow) {
          glow.style.opacity = (direction === 1 ? 1 - eased : eased).toFixed(3);
        }
        if (t >= 1) {
          finish();
          return;
        }
        frameRef.current = requestAnimationFrame(tick);
      };

      frameRef.current = requestAnimationFrame(tick);
      // rAF starves in background tabs; force the landing if it stalls.
      watchdogRef.current = window.setTimeout(() => {
        if (animatingRef.current) {
          finish();
        }
      }, WATCHDOG_MS);

      return LOCK_MS;
    },
    [],
  );

  return { handleFlip, heroDemoExpanded, cancel };
}

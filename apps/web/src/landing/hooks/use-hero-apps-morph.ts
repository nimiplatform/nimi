import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { HeroDemoSurface } from '../content/landing-content.js';
import type { PagingDirection } from './use-section-paging.js';

/**
 * Hero ↔ apps traveling zoom (lusion-style, DOM-crisp), in two beats:
 *
 * 1. Travel. On the flip gesture the hero demo window is lifted out of the
 *    document flow (position: fixed, so the hero section's clip bounds no
 *    longer apply) and glides from its hero slot onto the exact rect of the
 *    apps screen's window while the page scrolls — the window visibly travels
 *    and grows, still showing the surface the user was looking at.
 * 2. Switch. Once landed, the window's surface transitions to the destination
 *    surface: the current one fades out, the next one fades in, and only then
 *    is the real apps window revealed underneath in the same frame. Scrolling
 *    back up plays the mirror image: travel into the hero slot showing apps,
 *    then fade back to chat.
 *
 * Design choices:
 *
 * - Layout animation (left/top/width/height), never transform scale: scaling
 *   a DOM subtree rasterizes text into a blurry bitmap mid-flight, whereas
 *   relayout re-renders crisp type at every size and keeps border-radius
 *   honest. No rotation/overshoot either — a swinging window reads unstable.
 * - Both endpoint rects are read LIVE every frame: a placeholder holds the
 *   hero slot (so the grid never reflows and its rect tracks scroll position),
 *   and the real apps window stays in flow (visibility, not display). No
 *   cached geometry can drift.
 * - The scroll itself is driven by the same rAF loop (the live section
 *   offsetTop as the target), so the landing is exact by construction.
 * - The surface switch is a real transition, not a swap: the outgoing surface
 *   plays .demo-surface-leave, the incoming one plays .demo-surface-enter.
 */

const TRAVEL_MS = 820;
const LEAVE_MS = 160;
const ENTER_MS = 260;
const TOTAL_MS = TRAVEL_MS + LEAVE_MS + ENTER_MS;
const LOCK_MS = TOTAL_MS + 140;
const WATCHDOG_MS = TOTAL_MS + 700;

const SURFACE_SELECTOR = '[data-demo-surface]';
const GLOW_SELECTOR = '.hero-glow';
const LEAVE_CLASS = 'demo-surface-leave';

type MorphRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
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
  /** Surface forced onto the hero demo while a morph is in flight. */
  heroSurfaceOverride: HeroDemoSurface | null;
  /** While true, the hero demo renders its height-flexible (expanded) frame. */
  heroDemoExpanded: boolean;
  cancel: () => void;
};

export function useHeroAppsMorph(): HeroAppsMorph {
  const [heroSurfaceOverride, setHeroSurfaceOverride] = useState<HeroDemoSurface | null>(null);
  const [heroDemoExpanded, setHeroDemoExpanded] = useState(false);
  const animatingRef = useRef(false);
  const watchdogRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const frameRef = useRef(0);
  const restoreRef = useRef<(() => void) | null>(null);

  // Restore React's node before unmount removes its original parent. Also
  // stop the timers and frame loop so a retired flight cannot affect a new one.
  useLayoutEffect(() => () => restoreRef.current?.(), []);

  const cancel = useCallback(() => {
    if (!restoreRef.current) return;
    restoreRef.current();
    flushSync(() => {
      setHeroSurfaceOverride(null);
      setHeroDemoExpanded(false);
    });
  }, []);

  const handleFlip = useCallback((fromIndex: number, targetIndex: number, direction: PagingDirection): number | void => {
    const isHeroAppsPair = (fromIndex === 0 && targetIndex === 1) || (fromIndex === 1 && targetIndex === 0);
    if (!isHeroAppsPair || animatingRef.current) {
      return undefined;
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }
    if (
      typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
    // The traveling window switches surface mid-sequence, so it needs the
    // live demo; the static fallback keeps the default flip.
    if (!heroWrap.querySelector('[data-demo-interactive="true"]')) {
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

    // The window becomes height-flexible before the first styled frame. Going
    // down it keeps showing chat — the surface only switches after landing.
    // Coming back up the hero window is off-screen, so it may take the apps
    // surface on the spot: that is what the user is looking at in the apps
    // window it is about to replace.
    flushSync(() => {
      setHeroSurfaceOverride(direction === 1 ? null : 'apps');
      setHeroDemoExpanded(true);
    });
    // Reparenting a node (appendChild below, replaceWith at the end) removes
    // and re-inserts it, which restarts CSS animations on its subtree: the
    // settled surface would replay its enter fade in the first frames of the
    // lift — a blink on content the user is already looking at. Pin the
    // current surface to its final state before every move; the surface
    // switch after landing mounts a fresh element, so its enter still plays.
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
    // lands on its exact rect, switches surface, and hands over in one frame.
    appsWrap.style.visibility = 'hidden';
    if (heroCopy && direction === -1) {
      heroCopy.style.opacity = '0';
    }

    const clearTimers = () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
    const after = (ms: number, run: () => void) => {
      timersRef.current.push(window.setTimeout(() => {
        if (animatingRef.current) {
          run();
        }
      }, ms));
    };

    const restore = () => {
      restoreRef.current = null;
      animatingRef.current = false;
      // Disarm this flight's watchdog and pending beats: they otherwise stay
      // live past a clean finish, and once the paging lock releases the NEXT
      // flight can be airborne when a stale timer fires — it would see
      // animatingRef set and run this flight's finish (detached slot, wrong
      // direction scroll), stranding the demo window on <body>.
      window.clearTimeout(watchdogRef.current);
      window.cancelAnimationFrame(frameRef.current);
      clearTimers();
      heroWrap.querySelector<HTMLElement>(SURFACE_SELECTOR)?.classList.remove(LEAVE_CLASS);
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
        setHeroSurfaceOverride(null);
        setHeroDemoExpanded(false);
      });
    };

    // Beat 2: landed. Fade the current surface out, switch to the destination
    // surface (its keyed remount plays the enter animation), then hand over.
    const switchSurface = () => {
      const outgoing = heroWrap.querySelector<HTMLElement>(SURFACE_SELECTOR);
      if (outgoing) {
        // The lift pinned this surface with an inline animation: none, which
        // would also veto the leave animation. Clearing it and adding the
        // leave class in the same task yields one style recalc whose only
        // animation is the leave — the enter never restarts.
        outgoing.style.animation = '';
        outgoing.classList.add(LEAVE_CLASS);
      }
      after(LEAVE_MS, () => {
        // Going down the window adopts apps; coming up it releases the
        // override and returns to the hero's own (chat) surface.
        flushSync(() => {
          setHeroSurfaceOverride(direction === 1 ? 'apps' : null);
        });
        after(ENTER_MS, finish);
      });
    };

    const t0 = window.performance.now();
    let landed = false;
    const tick = () => {
      if (!animatingRef.current) {
        return;
      }
      if (landed) {
        // Beat 2 keeps the window glued to its destination rect: the sticky
        // header animates its height as the scroll state flips, and that
        // layout shift must be absorbed before the handoff frame, or the
        // window would jump when it returns to the flow.
        applyRect(heroWrap, direction === 1 ? rectOf(appsWrap) : rectOf(slot));
        frameRef.current = requestAnimationFrame(tick);
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
        heroCopy.style.opacity = (direction === 1
          ? clamp01(1 - t / 0.25)
          : clamp01((t - 0.65) / 0.35)
        ).toFixed(3);
      }
      if (glow) {
        glow.style.opacity = (direction === 1 ? 1 - eased : eased).toFixed(3);
      }
      if (t >= 1) {
        landed = true;
        switchSurface();
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
  }, []);

  return { handleFlip, heroSurfaceOverride, heroDemoExpanded, cancel };
}

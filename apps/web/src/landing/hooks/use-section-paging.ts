import { useEffect } from 'react';

export type PagingDirection = -1 | 1;

export type PagingDecision =
  | { kind: 'inner'; direction: PagingDirection }
  | { kind: 'flip'; targetIndex: number }
  | { kind: 'none' };

/**
 * Decide what one paging gesture should do:
 * - scroll inside the current section when it has more content in that
 *   direction (so expanded screens stay readable),
 * - otherwise flip to the adjacent section.
 */
export function resolvePagingDecision(input: {
  direction: PagingDirection;
  index: number;
  sectionCount: number;
  sectionScrollTop: number;
  sectionMaxScroll: number;
  slack?: number;
}): PagingDecision {
  const { direction, index, sectionCount, sectionScrollTop, sectionMaxScroll } = input;
  const slack = input.slack ?? 1;

  if (sectionCount <= 0 || index < 0 || index >= sectionCount) {
    return { kind: 'none' };
  }

  if (direction === 1) {
    if (sectionMaxScroll > slack && sectionScrollTop < sectionMaxScroll - slack) {
      return { kind: 'inner', direction };
    }
    return index < sectionCount - 1
      ? { kind: 'flip', targetIndex: index + 1 }
      : { kind: 'none' };
  }

  if (sectionMaxScroll > slack && sectionScrollTop > slack) {
    return { kind: 'inner', direction };
  }
  return index > 0 ? { kind: 'flip', targetIndex: index - 1 } : { kind: 'none' };
}

function landingSections(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('main > section[id]'));
}

function sectionStarts(sections: HTMLElement[]): number[] {
  // The first section starts below the in-flow sticky header; the true page
  // top is 0, so flipping back lands on the real top of the document.
  return sections.map((section, index) => (index === 0 ? 0 : section.offsetTop));
}

function nearestIndex(starts: number[], scrollY: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  starts.forEach((start, index) => {
    const distance = Math.abs(start - scrollY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

export const DEMO_OWNS_SCROLL_SELECTOR = '[data-demo-owns-scroll]';

/**
 * Structural view of a DOM event target, so ownership predicates stay
 * testable in node:test without a DOM. Real HTMLElements satisfy this shape.
 */
export type PagingEventTarget = {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  readonly closest?: (selector: string) => unknown;
} | null;

/**
 * A demo region owns every wheel/touch gesture that starts inside it — even
 * when an inner scroller sits at its top or bottom edge. Page paging only
 * owns gestures that start outside the region.
 */
export function isEventOwnedByDemoRegion(target: PagingEventTarget): boolean {
  return Boolean(
    target
    && typeof target.closest === 'function'
    && target.closest(DEMO_OWNS_SCROLL_SELECTOR),
  );
}

/**
 * Keys that edit text or activate controls must never trigger page paging,
 * and the demo region owns keys while focus is inside it.
 */
export function isPagingKeyExcludedTarget(target: PagingEventTarget): boolean {
  if (!target) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tagName)) {
    return true;
  }
  return isEventOwnedByDemoRegion(target);
}

/**
 * Forced full-page paging without a dependency: one wheel/swipe/key gesture
 * moves exactly one screen, while a screen taller than the viewport scrolls
 * internally first (future-proof for expanded content). Scrollbar dragging,
 * find-in-page, and programmatic scrolls stay untouched.
 */
export function useSectionPaging(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }
    const root = document.getElementById('top');
    if (!root) {
      return;
    }

    const reduceMotion = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

    let lockUntil = 0;
    let touchStartY: number | null = null;
    let touchFlipped = false;
    let touchOwnedByDemo = false;

    const now = () => window.performance.now();
    const locked = () => now() < lockUntil;

    const current = () => {
      const sections = landingSections();
      const starts = sectionStarts(sections);
      return { sections, starts, index: nearestIndex(starts, window.scrollY) };
    };

    const goTo = (index: number, instant = false) => {
      const { sections, starts } = current();
      if (sections.length === 0) {
        return;
      }
      const clamped = Math.max(0, Math.min(sections.length - 1, index));
      const top = starts[clamped] ?? 0;
      const skipAnimation = instant || Boolean(reduceMotion?.matches);
      lockUntil = now() + (skipAnimation ? 0 : 700);
      window.scrollTo({ top, behavior: skipAnimation ? 'auto' : 'smooth' });
    };

    const decide = (direction: PagingDirection): PagingDecision => {
      const { sections, index } = current();
      const section = sections[index];
      if (!section) {
        return { kind: 'none' };
      }
      return resolvePagingDecision({
        direction,
        index,
        sectionCount: sections.length,
        sectionScrollTop: section.scrollTop,
        sectionMaxScroll: section.scrollHeight - section.clientHeight,
      });
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) {
        return;
      }
      if (isEventOwnedByDemoRegion(event.target as PagingEventTarget)) {
        return;
      }
      const direction: PagingDirection = event.deltaY > 0 ? 1 : -1;
      if (locked()) {
        event.preventDefault();
        return;
      }
      const decision = decide(direction);
      if (decision.kind === 'inner') {
        return;
      }
      event.preventDefault();
      if (decision.kind === 'flip') {
        goTo(decision.targetIndex);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isPagingKeyExcludedTarget(event.target as PagingEventTarget)) {
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        goTo(0);
        return;
      }
      if (event.key === 'End') {
        const { sections } = current();
        event.preventDefault();
        goTo(sections.length - 1);
        return;
      }

      let direction: PagingDirection | null = null;
      if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
        direction = 1;
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        direction = -1;
      }
      if (direction === null || locked()) {
        return;
      }

      const decision = decide(direction);
      if (decision.kind === 'inner') {
        const { sections, index } = current();
        const section = sections[index];
        if (section) {
          event.preventDefault();
          section.scrollBy({
            top: direction * Math.round(section.clientHeight * 0.85),
            behavior: reduceMotion?.matches ? 'auto' : 'smooth',
          });
        }
        return;
      }
      event.preventDefault();
      if (decision.kind === 'flip') {
        goTo(decision.targetIndex);
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      touchOwnedByDemo = isEventOwnedByDemoRegion(event.target as PagingEventTarget);
      if (event.touches.length !== 1) {
        touchStartY = null;
        return;
      }
      touchStartY = event.touches[0]?.clientY ?? null;
      touchFlipped = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (touchOwnedByDemo) {
        return;
      }
      if (touchStartY === null || event.touches.length !== 1) {
        return;
      }
      const currentY = event.touches[0]?.clientY ?? touchStartY;
      const delta = touchStartY - currentY;
      if (Math.abs(delta) < 12) {
        return;
      }
      const direction: PagingDirection = delta > 0 ? 1 : -1;
      if (locked()) {
        event.preventDefault();
        return;
      }
      const decision = decide(direction);
      if (decision.kind === 'inner') {
        return;
      }
      event.preventDefault();
      if (!touchFlipped && Math.abs(delta) > 50 && decision.kind === 'flip') {
        touchFlipped = true;
        goTo(decision.targetIndex);
      }
    };

    const onTouchEnd = () => {
      touchStartY = null;
      touchFlipped = false;
      touchOwnedByDemo = false;
    };

    const onAnchorClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) {
        return;
      }
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href^="#"]');
      if (!anchor) {
        return;
      }
      const href = anchor.getAttribute('href') ?? '';
      if (href.length < 2) {
        return;
      }
      const id = decodeURIComponent(href.slice(1));
      const { sections } = current();
      const targetIndex = id === 'top' ? 0 : sections.findIndex((section) => section.id === id);
      if (targetIndex < 0) {
        return;
      }
      event.preventDefault();
      goTo(targetIndex);
      if (window.location.hash !== href) {
        window.history.pushState(null, '', href);
      }
    };

    const onFragmentNavigation = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
      if (!id) {
        return;
      }
      const { sections } = current();
      const targetIndex = id === 'top' ? 0 : sections.findIndex((section) => section.id === id);
      if (targetIndex >= 0) {
        goTo(targetIndex, true);
      }
    };

    const onResize = () => {
      const { index } = current();
      goTo(index, true);
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    root.addEventListener('click', onAnchorClick);
    window.addEventListener('hashchange', onFragmentNavigation);
    window.addEventListener('popstate', onFragmentNavigation);
    window.addEventListener('resize', onResize);

    // Land on the requested section when the page opens with a fragment.
    onFragmentNavigation();

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('click', onAnchorClick);
      window.removeEventListener('hashchange', onFragmentNavigation);
      window.removeEventListener('popstate', onFragmentNavigation);
      window.removeEventListener('resize', onResize);
    };
  }, [enabled]);
}

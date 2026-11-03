import { lazy, Suspense, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LandingContent } from '../content/landing-content.js';
import { COURTYARD_PARTNER, demoChapters, demoSectionIds } from '../content/demo-tour.js';
import { demoRegionInnerCanScroll } from '../hooks/use-section-paging.js';
import { DemoErrorBoundary } from './demo-error-boundary.js';
import { HeroDemoStatic } from './hero-demo-static.js';
import { useHeroDemoSession } from './hero-demo-context.js';
import { HomeTourCaption } from './home-tour-caption.js';

const HeroDemoView = lazy(async () => ({ default: (await import('./hero-demo.js')).HeroDemoView }));
const kitTargets: Record<string, string> = {
  composer: '[data-canonical-composer-root]',
  transcript: '[data-canonical-transcript-root]',
  memory: '[data-agent-center-cognition-memory]',
  'choose-partner': `[data-zhiyu-agent-handle="${COURTYARD_PARTNER}"]`,
};

/** Keep the live React tree mounted as its host moves between page sections.
 * The first two screens' zoom moves the hero slot, taking this same window along. */
export function SharedHomeWindow({ inFlight, content }: {
  inFlight: boolean;
  content: LandingContent;
}) {
  const { section = 0, guideStep, explore, demo, playing, preview, selectGuideStep, preferences } = useHeroDemoSession();
  const [host] = useState(() => document.createElement('div'));
  const [dialogBody, setDialogBody] = useState<HTMLDivElement | null>(null);
  const surface = preview ? dialogBody : host;
  const slot = inFlight ? 'hero' : demoSectionIds[section];
  const expanded = inFlight || slot !== 'hero';
  const chapter = demoChapters[section - 2];
  const stop = guideStep === undefined ? undefined : chapter?.stops[guideStep];

  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-home-slot="${slot}"]`);
    if (!target) return;
    host.className = 'shared-home-host';
    host.dataset.tourSurface = '';
    target.appendChild(host);
    return () => host.remove();
  }, [host, slot]);

  useLayoutEffect(() => {
    if (!surface || !chapter || !stop || guideStep === undefined) return;
    let marked: HTMLElement | null = null;
    let timer: number | undefined;
    const mark = () => {
      const selector = kitTargets[stop.anchor] ?? `[data-tour-anchor="${stop.anchor}"]`;
      const target = surface.querySelector<HTMLElement>(selector);
      if (marked === target) return;
      window.clearTimeout(timer);
      marked?.removeAttribute('data-tour-current');
      marked = target;
      if (!target) return;
      target.dataset.tourCurrent = String(guideStep + 1);
      if (playing && !preferences.reducedMotion && !document.hidden && guideStep + 1 < chapter.stops.length) {
        timer = window.setTimeout(() => selectGuideStep(guideStep + 1), 7500);
      }
      // Reveal the annotated control inside Home or an App without moving the landing page.
      for (let parent = target.parentElement; parent && parent !== surface; parent = parent.parentElement) {
        if (!/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight) continue;
        const box = parent.getBoundingClientRect();
        const item = target.getBoundingClientRect();
        // Leave room below the control for its result, e.g. a filtered journal entry.
        if (item.top < box.top || item.top > box.bottom - Math.min(145, box.height / 3))
          parent.scrollTop += (item.top - box.top - 12) * parent.clientHeight / box.height;
      }
    };
    mark();
    // App previews lazy-load inside Suspense, so their targets can arrive after the navigation commit.
    const observer = new MutationObserver(mark);
    observer.observe(surface, { childList: true, subtree: true });
    const handsOn = () => explore();
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && event.deltaY && demoRegionInnerCanScroll(event.target as HTMLElement, event.deltaY > 0 ? 1 : -1)) explore();
    };
    surface.addEventListener('pointerdown', handsOn, true);
    surface.addEventListener('focusin', handsOn, true);
    surface.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      marked?.removeAttribute('data-tour-current');
      surface.removeEventListener('pointerdown', handsOn, true);
      surface.removeEventListener('focusin', handsOn, true);
      surface.removeEventListener('wheel', onWheel);
    };
  }, [surface, chapter, stop, guideStep, explore, playing, preferences.reducedMotion, selectGuideStep]);

  if (!slot || slot === 'get-started') return null;
  const fallback = <HeroDemoStatic demo={demo} surface={slot === 'apps' ? 'chat' : 'home'} expanded={expanded} />;
  const failure = (
    <div className="hero-demo-frame tour-load-state" role="status">
      <strong>{demo.windowTitle}</strong><p>{content.guide.unavailable}</p>
      <button type="button" onClick={() => window.location.reload()}>{content.guide.retry}</button>
    </div>
  );
  return createPortal(
    <DemoErrorBoundary fallback={failure}>
      <Suspense fallback={chapter ? <div className="hero-demo-frame tour-load-state" aria-busy="true">{content.guide.loading}</div> : fallback}>
        <HeroDemoView expanded={expanded} riskCopy={content.riskControl} onPreviewBody={setDialogBody}
          previewCaption={preview?.guided && chapter ? <HomeTourCaption copy={content[chapter.copy]} controls={content.guide} /> : undefined} />
      </Suspense>
    </DemoErrorBoundary>, host,
  );
}

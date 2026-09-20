import { Suspense, lazy } from 'react';
import type { LandingContent } from '../content/landing-content.js';
import { DemoErrorBoundary } from './demo-error-boundary.js';
import { HeroDemoStatic } from './hero-demo-static.js';

const HeroDemoView = lazy(async () => ({
  default: (await import('./hero-demo.js')).HeroDemoView,
}));

export type AppsSectionProps = {
  content: LandingContent['apps'];
  demo: LandingContent['hero']['demo'];
};

/**
 * Second screen: a full-screen desktop-app window opened on the apps surface.
 * Scrolling down from the hero zooms the hero demo window into this one
 * (see use-hero-apps-morph), so the frame chrome and background mirror the
 * hero demo for a seamless handoff. The window stays fully interactive.
 */
export function AppsSection({ content, demo }: AppsSectionProps) {
  return (
    <section id="apps" className="screen-section relative overflow-hidden text-slate-900">
      <div className="pointer-events-none absolute inset-0 -z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 bg-gradient-to-br from-[#e8fbf3] via-[#eaf5fe] to-[#f4ecff]" />
        <div className="absolute left-[-10rem] top-[-8rem] h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgba(56,214,163,0.18),transparent)]" />
        <div className="absolute right-[-6rem] top-8 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,rgba(14,165,233,0.14),transparent)]" />
      </div>

      <div className="container-hero relative z-10 flex min-h-0 w-full flex-1 flex-col px-1 pb-4 pt-[9rem] md:pt-[10.5rem]">
        <div className="shrink-0 px-2 pb-4 text-center md:pb-5" data-apps-copy>
          <h2 className="font-display text-[clamp(1.5rem,2.6vw,2.25rem)] font-semibold leading-tight tracking-tight text-slate-900">
            {content.title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 md:mt-1.5 md:text-base">
            {content.subtitle}
          </p>
        </div>
        <div className="mx-auto my-auto min-h-0 max-h-[840px] min-w-0 w-full max-w-[1360px] flex-1" data-apps-morph>
          <DemoErrorBoundary fallback={<HeroDemoStatic demo={demo} surface="apps" expanded />}>
            <Suspense fallback={<HeroDemoStatic demo={demo} surface="apps" expanded />}>
              <HeroDemoView demo={demo} defaultSurface="apps" expanded />
            </Suspense>
          </DemoErrorBoundary>
        </div>
      </div>
    </section>
  );
}

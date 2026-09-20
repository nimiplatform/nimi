import { Suspense, lazy } from 'react';
import type { HeroDemoSurface, LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { DemoErrorBoundary } from './demo-error-boundary.js';
import { HeroDemoStatic } from './hero-demo-static.js';

const HeroDemoView = lazy(async () => ({
  default: (await import('./hero-demo.js')).HeroDemoView,
}));

export type HeroSectionProps = {
  content: LandingContent['hero'];
  links: LandingLinks;
  /** Forced demo surface while the hero↔apps morph runs (null = interactive). */
  demoSurfaceOverride?: HeroDemoSurface | null;
  /** While the morph runs, the demo frame stretches with its animated wrapper
   * instead of using its fixed hero heights. */
  demoExpanded?: boolean;
};

/** Closing sentence punctuation that may carry the small brand accent. */
const ACCENT_PUNCTUATION = /^(.*?)([.。!?！？])$/u;

export function HeroSection(props: HeroSectionProps) {
  const { content, links, demoSurfaceOverride = null, demoExpanded = false } = props;
  const sloganAccent = content.sloganAccent;
  const hasAccent = sloganAccent.length > 0 && content.slogan.endsWith(sloganAccent);
  const sloganLead = hasAccent
    ? content.slogan.slice(0, content.slogan.length - sloganAccent.length).trimEnd()
    : '';
  // The headline is one dark ink; only the closing punctuation carries teal.
  const accentParts = ACCENT_PUNCTUATION.exec(sloganAccent);
  const accentText = accentParts?.[1] ?? sloganAccent;
  const accentPunctuation = accentParts?.[2] ?? '';
  const subSloganLines = content.subSlogan.split('\n').filter((line) => line.length > 0);

  return (
    <section
      id="hero"
      className="hero-section screen-section relative isolate overflow-hidden pb-8 pt-10 text-ink lg:pb-24 lg:pt-8"
    >
      <div aria-hidden="true" className="hero-backdrop" />
      <div className="container-hero relative">
        <div className="hero-layout">
          <div className="min-w-0" data-hero-copy>
            {/* Display type is the hero's primary asset: dark ink, medium
                weight, tight leading. Size follows the viewport between the
                phone floor and the large-desktop cap. */}
            <h1
              aria-label={content.slogan}
              className="font-display text-[clamp(2.75rem,5.8vw,6rem)] font-bold leading-[1] tracking-[-0.035em] text-ink md:mt-8"
            >
              {hasAccent ? (
                <>
                  {sloganLead ? (
                    <>
                      <span>{sloganLead}</span>{' '}
                    </>
                  ) : null}
                  {/* Keep the accent unbroken: a mid-phrase wrap would orphan
                      trailing characters onto their own line. */}
                  <span className="whitespace-nowrap">
                    {accentText}
                    {accentPunctuation ? (
                      <span className="text-[#14b8a6]">{accentPunctuation}</span>
                    ) : null}
                  </span>
                </>
              ) : (
                content.slogan
              )}
            </h1>
            <p className="mt-6 max-w-[34rem] text-lg leading-8 md:mt-8 md:text-xl md:leading-9 lg:text-lg lg:leading-8 xl:text-2xl xl:leading-10">
              {subSloganLines.map((line, index) => (
                <span
                  key={line}
                  className={`block [text-wrap:balance] ${index === 0 ? 'font-medium text-slate-700' : 'text-slate-500'}`}
                >
                  {line}
                </span>
              ))}
            </p>
            <p className="mt-3 max-w-[32rem] text-base leading-7 text-slate-500 xl:text-lg xl:leading-8">
              {content.subSloganNote}
            </p>
            {/* One strong primary action. The secondary is a lighter outlined
                control that opens the docs folder on GitHub in a new tab. */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 md:mt-10">
              <a href={links.downloadUrl} className="hero-cta-primary">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-5 w-5"
                >
                  <path d="M12 4v11" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M5 20h14" />
                </svg>
                {content.downloadCta}
              </a>
              <a
                href={links.docsSourceUrl}
                target="_blank"
                rel="noreferrer"
                className="hero-cta-secondary group"
              >
                {content.docsCta}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                >
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </a>
            </div>
            <p className="mt-5 text-[15px] text-slate-500">{content.downloadNote}</p>
          </div>

          {/*
            Interactive desktop-app preview composed from public Kit components
            and local sample data: it does not import Desktop renderer source,
            start any process, call any backend, or represent a working product
            session. Loads as its own chunk; failures degrade to a static frame.
            The data-hero-morph wrapper is the transform target for the
            hero→apps zoom transition (see use-hero-apps-morph). Only the
            window's container, scale, and surroundings are styled here; the
            preview's own surfaces are untouched.
          */}
          <div className="hero-product relative min-w-0" data-hero-morph>
            <div aria-hidden="true" className="hero-glow" />
            <DemoErrorBoundary fallback={<HeroDemoStatic demo={content.demo} />}>
              <Suspense fallback={<HeroDemoStatic demo={content.demo} />}>
                <HeroDemoView demo={content.demo} surfaceOverride={demoSurfaceOverride} expanded={demoExpanded} />
              </Suspense>
            </DemoErrorBoundary>
          </div>
        </div>
      </div>
    </section>
  );
}

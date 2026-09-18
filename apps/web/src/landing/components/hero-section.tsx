import { Suspense, lazy } from 'react';
import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { GradientText } from './gradient-text.js';
import { DemoErrorBoundary } from './demo-error-boundary.js';
import { HeroDemoStatic } from './hero-demo-static.js';

const HeroDemoView = lazy(async () => ({
  default: (await import('./hero-demo.js')).HeroDemoView,
}));

export type HeroSectionProps = {
  content: LandingContent['hero'];
  links: LandingLinks;
};

export function HeroSection(props: HeroSectionProps) {
  const { content, links } = props;
  const sloganAccent = content.sloganAccent;
  const hasAccent = sloganAccent.length > 0 && content.slogan.endsWith(sloganAccent);
  const sloganLead = hasAccent
    ? content.slogan.slice(0, content.slogan.length - sloganAccent.length).trimEnd()
    : '';

  return (
    <>
      <section
        id="hero"
        className="screen-section relative overflow-hidden bg-transparent pb-16 pt-24 text-slate-900 md:pb-20 md:pt-28"
      >
        <div className="pointer-events-none absolute inset-0 -z-0 overflow-hidden" aria-hidden="true">
          <div className="absolute inset-0 bg-gradient-to-br from-[#e8fbf3] via-[#eaf5fe] to-[#f4ecff]" />
          <div className="absolute left-[-10rem] top-[-8rem] h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgba(56,214,163,0.18),transparent)]" />
          <div className="absolute right-[-6rem] top-8 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,rgba(14,165,233,0.14),transparent)]" />
        </div>

        <div className="container-hero relative z-10">
          <div className="mx-auto max-w-3xl text-center">
            <h1
              aria-label={content.slogan}
              className="font-display whitespace-nowrap text-[clamp(2.25rem,4.5vw,4rem)] font-semibold leading-[1.1] tracking-tight text-slate-900"
            >
              {hasAccent ? (
                <>
                  {sloganLead ? (
                    <>
                      <span>{sloganLead}</span>{' '}
                    </>
                  ) : null}
                  <GradientText text={sloganAccent} />
                </>
              ) : (
                content.slogan
              )}
            </h1>
            <p className="mt-4 text-base font-medium leading-7 text-slate-600 md:text-lg">
              {content.subSlogan}
            </p>
            {content.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-600">
                {paragraph}
              </p>
            ))}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
              <a
                href={links.downloadUrl}
                className="inline-flex min-w-44 items-center justify-center rounded-full bg-gradient-to-r from-[#38d6a3] to-[#0ea5e9] px-7 py-3.5 text-base font-bold text-white shadow-[0_16px_34px_-14px_rgba(14,165,233,0.7)] transition hover:-translate-y-0.5"
              >
                {content.downloadCta}
              </a>
              <a
                href={links.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-44 items-center justify-center rounded-full border border-slate-300 bg-white/75 px-7 py-3.5 text-base font-bold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-white"
              >
                {content.docsCta}
              </a>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-700">{content.availableNote}</p>
          </div>
        </div>
      </section>

      <section
        id="demo"
        className="screen-section relative overflow-hidden bg-transparent py-10 text-slate-900"
      >
        <div className="pointer-events-none absolute inset-0 -z-0 overflow-hidden" aria-hidden="true">
          <div className="absolute inset-0 bg-gradient-to-br from-[#e8fbf3] via-[#eaf5fe] to-[#f4ecff]" />
          <div className="absolute right-[-8rem] bottom-[-6rem] h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgba(56,214,163,0.14),transparent)]" />
          <div className="absolute left-[-6rem] top-10 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,rgba(14,165,233,0.12),transparent)]" />
        </div>

        {/*
          Interactive desktop-app preview composed from public Kit components
          and local sample data: it does not import Desktop renderer source,
          start any process, call any backend, or represent a working product
          session. Loads as its own chunk; failures degrade to a static frame.
        */}
        {/* Cap the demo window width so the mockup keeps a normal ~3:2
            screen proportion: rendered height is fixed (~703px at lg after
            the frame's 0.85 zoom), so 1064px lands at 3:2. */}
        <div className="container-hero relative z-10 w-full max-w-[1064px]">
          <DemoErrorBoundary fallback={<HeroDemoStatic demo={content.demo} />}>
            <Suspense fallback={<HeroDemoStatic demo={content.demo} />}>
              <HeroDemoView demo={content.demo} />
            </Suspense>
          </DemoErrorBoundary>
        </div>
      </section>
    </>
  );
}

import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';

export type GetStartedSectionProps = {
  content: LandingContent['getStarted'];
  links: LandingLinks;
};

export function GetStartedSection({ content, links }: GetStartedSectionProps) {
  return (
    <section id="get-started" className="section-pad screen-section bg-white">
      <div className="container-nimi">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
            {content.title}
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">{content.subtitle}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href={links.downloadUrl}
              aria-describedby="get-started-availability"
              className="inline-flex min-w-44 items-center justify-center rounded-full bg-gradient-to-r from-[#0f766e] to-[#0369a1] px-7 py-3.5 text-base font-bold text-white shadow-[0_16px_34px_-14px_rgba(3,105,161,0.7)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-14px_rgba(3,105,161,0.8)]"
            >
              {content.primaryCta}
            </a>
            <a
              href="#apps"
              className="inline-flex min-w-44 items-center justify-center rounded-full border border-slate-300 bg-white px-7 py-3.5 text-base font-bold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300"
            >
              {content.secondaryCta}
            </a>
          </div>
          <p id="get-started-availability" className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-600">
            {content.availability}
          </p>
        </div>
      </div>
    </section>
  );
}

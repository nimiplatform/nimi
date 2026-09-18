import type { LandingContent } from '../content/landing-content.js';
import { SectionHeader } from './section-header.js';

export type ContinuitySectionProps = {
  content: LandingContent['continuity'];
};

export function ContinuitySection({ content }: ContinuitySectionProps) {
  return (
    <section id="continuity" className="section-pad screen-section bg-slate-950 text-slate-100">
      <div className="container-nimi">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
            {content.title}
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">{content.subtitle}</p>
          <p className="mt-6 text-base leading-7 text-slate-200">{content.body}</p>
          <ul className="mt-8 flex flex-col items-center gap-2 text-sm text-slate-400 sm:flex-row sm:justify-center sm:gap-6">
            {content.supports.map((support) => (
              <li key={support} className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#38d6a3]" aria-hidden="true" />
                {support}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { SectionHeader } from './section-header.js';

export type WorldsSectionProps = {
  content: LandingContent['worlds'];
  links: LandingLinks;
};

export function WorldsSection({ content, links }: WorldsSectionProps) {
  return (
    <section id="worlds" className="section-pad screen-section relative overflow-hidden bg-[#f4fbfa]">
      <div className="container-nimi">
        <SectionHeader
          title={content.title}
          subtitle={content.subtitle}
          actions={
            <a className="cta-primary" href={`${links.worldsUrl}#worlds`}>
              {content.cta}
            </a>
          }
        />
        <p className="mt-6 max-w-3xl text-base leading-7 text-slate-600">{content.body}</p>

        <div className="mt-6 max-w-3xl rounded-[1.35rem] border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            {content.exampleTitle}
          </h3>
          <ol className="mt-4 space-y-3">
            {content.exampleSteps.map((step, index) => (
              <li key={step} className="flex gap-3 text-sm leading-6 text-slate-600">
                <span className="font-bold text-[#2ba980]">{String(index + 1).padStart(2, '0')}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { SectionHeader } from './section-header.js';

export type CreateSectionProps = {
  content: LandingContent['create'];
  links: LandingLinks;
};

export function CreateSection({ content, links }: CreateSectionProps) {
  return (
    <section id="create" className="section-pad screen-section relative overflow-hidden bg-[#f4fbfa]">
      <div className="container-nimi">
        <SectionHeader title={content.title} subtitle={content.subtitle} />

        <p className="mt-6 max-w-3xl text-base leading-7 text-slate-600">{content.body}</p>

        <ol className="mt-8 grid gap-4 md:grid-cols-2">
          {content.steps.map((step, index) => (
            <li
              key={step.title}
              className="rounded-[1.35rem] border border-slate-200 bg-white p-5"
            >
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#2ba980]">
                {String(index + 1).padStart(2, '0')}
              </p>
              <h3 className="mt-3 text-lg font-semibold tracking-tight text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <p className="max-w-2xl text-sm leading-6 text-slate-600">{content.caveat}</p>
          <a className="cta-primary w-fit" href={links.createAppUrl}>
            {content.cta}
          </a>
        </div>
      </div>
    </section>
  );
}

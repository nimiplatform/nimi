import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { SectionHeader } from './section-header.js';

export type CapabilitiesSectionProps = {
  content: LandingContent['capabilities'];
  links: LandingLinks;
};

export function CapabilitiesSection({ content, links }: CapabilitiesSectionProps) {
  return (
    <section id="models" className="section-pad screen-section bg-white">
      <div className="container-nimi">
        <SectionHeader title={content.title} subtitle={content.subtitle} />

        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {content.tasks.map((task) => (
            <article
              key={task.id}
              className="rounded-[1.35rem] border border-slate-200 bg-slate-50 p-5"
            >
              <h3 className="text-lg font-semibold tracking-tight text-slate-900">{task.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{task.description}</p>
            </article>
          ))}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-[1.35rem] border border-slate-200 bg-white p-5">
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">{content.localTitle}</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">{content.localText}</p>
          </article>
          <article className="rounded-[1.35rem] border border-slate-200 bg-white p-5">
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">{content.cloudTitle}</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">{content.cloudText}</p>
          </article>
        </div>

        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <p className="max-w-2xl text-sm leading-6 text-slate-600">{content.costNote}</p>
          <a className="cta-primary w-fit" href={links.modelsUrl}>
            {content.cta}
          </a>
        </div>
      </div>
    </section>
  );
}

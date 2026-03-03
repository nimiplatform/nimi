import type { LandingContent } from '../content/landing-content.js';
import { SectionHeader } from './section-header.js';

export type JourneySectionProps = {
  content: LandingContent['journey'];
};

export function JourneySection(props: JourneySectionProps) {
  return (
    <section className="section-pad">
      <div className="container-nimi">
        <SectionHeader title={props.content.title} subtitle={props.content.subtitle} />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {props.content.steps.map((step, index) => (
            <article key={step.title} className="card-surface reveal">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Step {index + 1}</p>
              <h3 className="mt-3 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-200/85">{step.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

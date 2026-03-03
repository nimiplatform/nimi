import type { LandingContent } from '../content/landing-content.js';
import { SectionHeader } from './section-header.js';

export type StackSectionProps = {
  content: LandingContent['stack'];
};

export function StackSection(props: StackSectionProps) {
  return (
    <section className="section-pad">
      <div className="container-nimi">
        <SectionHeader title={props.content.title} subtitle={props.content.subtitle} />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {props.content.items.map((item) => (
            <article key={item.name} className="card-surface reveal">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-mint-300">{item.name}</p>
              <h3 className="mt-3 text-lg font-semibold text-white">{item.role}</h3>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-200/85">
                {item.points.map((point) => (
                  <li key={point} className="flex gap-2">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 rounded-full bg-mint-300" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

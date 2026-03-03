import type { LandingContent } from '../content/landing-content.js';
import { SectionHeader } from './section-header.js';

export type SecuritySectionProps = {
  content: LandingContent['security'];
};

export function SecuritySection(props: SecuritySectionProps) {
  return (
    <section id="security" className="section-pad">
      <div className="container-nimi">
        <SectionHeader title={props.content.title} subtitle={props.content.subtitle} />
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <article className="card-surface reveal">
            <h3 className="text-lg font-semibold text-white">{props.content.safeguardsTitle}</h3>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-200/85">
              {props.content.safeguards.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
          <article className="card-surface reveal">
            <h3 className="text-lg font-semibold text-white">{props.content.governanceTitle}</h3>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-200/85">
              {props.content.governance.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 rounded-full bg-teal-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

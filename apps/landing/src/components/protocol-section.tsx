import type { LandingContent } from '../content/landing-content.js';
import { SectionHeader } from './section-header.js';

export type ProtocolSectionProps = {
  content: LandingContent['protocol'];
};

export function ProtocolSection(props: ProtocolSectionProps) {
  return (
    <section id="protocol" className="section-pad">
      <div className="container-nimi">
        <SectionHeader title={props.content.title} subtitle={props.content.subtitle} />
        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {props.content.items.map((item) => (
            <article key={item.name} className="card-surface reveal">
              <h3 className="text-xl font-semibold text-white">{item.name}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-200/85">{item.summary}</p>
              <p className="mt-4 rounded-lg border border-mint-300/25 bg-mint-500/10 px-3 py-2 text-xs leading-5 text-mint-100">
                {item.guarantee}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

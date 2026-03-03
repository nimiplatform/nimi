import type { LandingContent } from '../content/landing-content.js';
import { SectionHeader } from './section-header.js';

export type ValueSectionProps = {
  content: LandingContent['why'];
};

function ValueCard(props: { title: string; description: string }) {
  return (
    <article className="card-surface reveal">
      <h4 className="text-lg font-semibold text-white">{props.title}</h4>
      <p className="mt-3 text-sm leading-6 text-slate-200/85">{props.description}</p>
    </article>
  );
}

export function ValueSection(props: ValueSectionProps) {
  return (
    <section id="for-builders" className="section-pad">
      <div className="container-nimi">
        <SectionHeader title={props.content.title} subtitle={props.content.subtitle} />
        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <div>
            <h3 className="reveal text-xl font-semibold text-mint-100">{props.content.buildersTitle}</h3>
            <div className="mt-5 grid gap-4">
              {props.content.builders.map((item) => (
                <ValueCard key={item.title} title={item.title} description={item.description} />
              ))}
            </div>
          </div>
          <div id="for-users">
            <h3 className="reveal text-xl font-semibold text-sky-100">{props.content.usersTitle}</h3>
            <div className="mt-5 grid gap-4">
              {props.content.users.map((item) => (
                <ValueCard key={item.title} title={item.title} description={item.description} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

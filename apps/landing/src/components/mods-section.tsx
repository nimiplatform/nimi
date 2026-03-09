import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { SectionHeader } from './section-header.js';

export type ModsSectionProps = {
  content: LandingContent['mods'];
  links: LandingLinks;
};

export function ModsSection(props: ModsSectionProps) {
  return (
    <section id="mods" className="section-pad">
      <div className="container-nimi">
        <SectionHeader title={props.content.title} subtitle={props.content.subtitle} />

        <div className="mt-10 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {props.content.items.map((item) => (
            <article key={item.name} className="card-surface reveal">
              <div className="flex items-start gap-3">
                <span className="text-2xl" role="img" aria-hidden="true">{item.icon}</span>
                <div>
                  <h3 className="text-sm font-semibold text-white">{item.name}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-300/90">{item.description}</p>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="reveal mt-8 text-center">
          <a className="cta-secondary" href={props.links.modDocsUrl} target="_blank" rel="noreferrer">
            {props.content.buildModCta}
          </a>
        </div>
      </div>
    </section>
  );
}

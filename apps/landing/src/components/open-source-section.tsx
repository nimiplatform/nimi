import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { SectionHeader } from './section-header.js';

export type OpenSourceSectionProps = {
  content: LandingContent['openSource'];
  links: LandingLinks;
};

export function OpenSourceSection(props: OpenSourceSectionProps) {
  return (
    <section className="section-pad">
      <div className="container-nimi">
        <SectionHeader title={props.content.title} subtitle={props.content.subtitle} />
        <p className="reveal mt-6 max-w-3xl text-base leading-7 text-slate-200/90">{props.content.description}</p>
        <div className="reveal mt-8 flex flex-wrap gap-3">
          <a className="cta-primary" href={props.links.githubUrl} target="_blank" rel="noreferrer">
            {props.content.githubCta}
          </a>
          <a className="cta-ghost" href={props.links.docsUrl} target="_blank" rel="noreferrer">
            {props.content.docsCta}
          </a>
        </div>
      </div>
    </section>
  );
}

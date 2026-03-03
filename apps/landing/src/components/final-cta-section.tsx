import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';

export type FinalCtaSectionProps = {
  content: LandingContent['finalCta'];
  links: LandingLinks;
};

export function FinalCtaSection(props: FinalCtaSectionProps) {
  return (
    <section className="section-pad pb-20 md:pb-28">
      <div className="container-nimi">
        <div className="reveal rounded-3xl border border-mint-300/25 bg-gradient-to-br from-mint-500/20 via-teal-500/10 to-cyan-500/20 p-8 shadow-2xl shadow-mint-950/30 md:p-12">
          <h2 className="text-balance text-3xl font-semibold text-white md:text-4xl">{props.content.title}</h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-100/90">{props.content.description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a className="cta-primary" href={props.links.docsUrl} target="_blank" rel="noreferrer">
              {props.content.builderCta}
            </a>
            <a className="cta-secondary" href={props.links.appUrl} target="_blank" rel="noreferrer">
              {props.content.userCta}
            </a>
            <a className="cta-ghost" href={props.links.githubUrl} target="_blank" rel="noreferrer">
              {props.content.githubCta}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

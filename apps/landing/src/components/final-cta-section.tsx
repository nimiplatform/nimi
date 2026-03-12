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
        <div className="reveal rounded-3xl border border-[#38d6a3]/20 bg-gradient-to-br from-[#38d6a3]/10 via-teal-500/5 to-[#0ea5e9]/10 p-8 shadow-2xl shadow-slate-200 md:p-12">
          <h2 className="text-balance text-3xl font-semibold text-slate-900 md:text-4xl">{props.content.title}</h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">{props.content.description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a className="cta-primary" href={props.links.docsUrl} target="_blank" rel="noreferrer">
              {props.content.primaryCta}
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

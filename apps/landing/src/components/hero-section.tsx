import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';

export type HeroSectionProps = {
  content: LandingContent['hero'];
  links: LandingLinks;
};

export function HeroSection(props: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden pb-16 pt-30 md:pb-24 md:pt-36">
      <div className="orb orb-one" aria-hidden="true" />
      <div className="orb orb-two" aria-hidden="true" />
      <div className="orb orb-three" aria-hidden="true" />
      <div className="container-nimi relative">
        <div className="reveal max-w-4xl">
          <p className="inline-flex rounded-full border border-mint-300/30 bg-mint-300/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-mint-100">
            {props.content.eyebrow}
          </p>
          <h1 className="mt-6 text-balance text-4xl font-semibold leading-tight text-white md:text-6xl">
            {props.content.title}
          </h1>
          <p className="mt-4 text-xl text-mint-100 md:text-2xl">{props.content.subtitle}</p>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-200/90">{props.content.description}</p>

          <div className="mt-10 flex flex-wrap gap-3">
            <a
              href={props.links.docsUrl}
              className="cta-primary"
              target="_blank"
              rel="noreferrer"
            >
              {props.content.builderCta}
            </a>
            <a
              href={props.links.appUrl}
              className="cta-secondary"
              target="_blank"
              rel="noreferrer"
            >
              {props.content.userCta}
            </a>
            <a
              href={props.links.docsUrl}
              className="cta-ghost"
              target="_blank"
              rel="noreferrer"
            >
              {props.content.docsCta}
            </a>
          </div>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-300/85">{props.content.trust}</p>
        </div>
      </div>
    </section>
  );
}

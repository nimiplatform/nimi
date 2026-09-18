import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';

export type DevelopersSectionProps = {
  content: LandingContent['developers'];
  links: LandingLinks;
};

export function DevelopersSection({ content, links }: DevelopersSectionProps) {
  return (
    <section id="developers" className="section-pad screen-section bg-[#f4fbfa]">
      <div className="container-nimi">
        <div className="md:max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#2ba980]">
            {content.eyebrow}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
            {content.title}
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">{content.subtitle}</p>
          <p className="mt-4 text-base leading-7 text-slate-600">{content.body}</p>
        </div>

        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {content.points.map((point) => (
            <li
              key={point}
              className="rounded-[1.35rem] border border-slate-200 bg-white p-5 text-sm leading-7 text-slate-700"
            >
              {point}
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap gap-3">
          <a className="cta-primary" href={links.appUrl} target="_blank" rel="noreferrer">
            {content.primaryCta}
          </a>
          <a
            className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-700 transition hover:border-emerald-300"
            href={links.githubUrl}
            target="_blank"
            rel="noreferrer"
          >
            {content.secondaryCta}
          </a>
        </div>
      </div>
    </section>
  );
}

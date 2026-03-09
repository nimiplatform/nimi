import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { SectionHeader } from './section-header.js';

export type DesktopSectionProps = {
  content: LandingContent['desktop'];
  links: LandingLinks;
};

export function DesktopSection(props: DesktopSectionProps) {
  return (
    <section id="desktop" className="section-pad">
      <div className="container-nimi">
        <SectionHeader title={props.content.title} subtitle={props.content.subtitle} />

        <div className="reveal mt-10 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-mint-500/10 via-teal-500/5 to-cyan-500/10">
          <div className="flex aspect-video items-center justify-center">
            <p className="text-lg text-slate-400">{props.content.screenshotAlt}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {props.content.features.map((feature) => (
            <article key={feature.title} className="card-surface reveal">
              <div className="flex items-start gap-3">
                <span className="text-2xl" role="img" aria-hidden="true">{feature.icon}</span>
                <div>
                  <h3 className="text-sm font-semibold text-white">{feature.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-300/90">{feature.description}</p>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="reveal mt-8 text-center">
          <a className="cta-primary" href={props.links.desktopDownloadUrl} target="_blank" rel="noreferrer">
            {props.content.downloadCta}
          </a>
        </div>
      </div>
    </section>
  );
}

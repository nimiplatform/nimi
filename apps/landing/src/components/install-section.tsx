import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { SectionHeader } from './section-header.js';

export type InstallSectionProps = {
  content: LandingContent['install'];
  links: LandingLinks;
};

export function InstallSection(props: InstallSectionProps) {
  return (
    <section id="install" className="section-pad">
      <div className="container-nimi">
        <SectionHeader title={props.content.title} subtitle={props.content.subtitle} />
        <div className="mt-10 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <article className="card-surface reveal">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-mint-200">{props.content.terminalLabel}</h3>
            <div className="mt-4 space-y-3 text-sm leading-6">
              {props.content.terminalSteps.map((step) => (
                <div key={step.command}>
                  <p className="text-slate-400 font-mono text-xs"># {step.comment}</p>
                  <code className="font-mono text-cyan-100">{step.command}</code>
                </div>
              ))}
            </div>
          </article>

          <article className="card-surface reveal">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-mint-200">{props.content.sdkLabel}</h3>
            <pre className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/75 p-4 text-xs leading-6 text-slate-100">
              <code>{props.content.sdkSnippet}</code>
            </pre>
            <div className="mt-4">
              <a className="cta-secondary" href={props.links.docsUrl} target="_blank" rel="noreferrer">
                {props.content.docsCtaLabel}
              </a>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

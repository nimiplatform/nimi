import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { SectionHeader } from './section-header.js';

export type QuickstartSectionProps = {
  content: LandingContent['quickstart'];
  links: LandingLinks;
};

export function QuickstartSection(props: QuickstartSectionProps) {
  return (
    <section id="quickstart" className="section-pad">
      <div className="container-nimi">
        <SectionHeader title={props.content.title} subtitle={props.content.subtitle} />
        <div className="mt-10 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <article className="card-surface reveal">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-mint-200">{props.content.commandsLabel}</h3>
            <ol className="mt-4 space-y-2 text-sm leading-6 text-slate-200/90">
              {props.content.commands.map((command, index) => (
                <li key={command}>
                  <span className="mr-3 inline-flex w-5 justify-end text-mint-300">{index + 1}.</span>
                  <code className="font-mono text-cyan-100">{command}</code>
                </li>
              ))}
            </ol>
          </article>

          <article className="card-surface reveal">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-mint-200">{props.content.sdkLabel}</h3>
            <pre className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/75 p-4 text-xs leading-6 text-slate-100">
              <code>{props.content.sdkSnippet}</code>
            </pre>
            <div className="mt-4 flex flex-wrap gap-3">
              <a className="cta-secondary" href={props.links.docsUrl} target="_blank" rel="noreferrer">
                {props.content.docsCta}
              </a>
              <a className="cta-ghost" href={props.links.protocolUrl} target="_blank" rel="noreferrer">
                {props.content.protocolCta}
              </a>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

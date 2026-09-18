import type { LandingContent } from '../content/landing-content.js';
import { buildAppDetailUrl, type LandingLinks } from '../config/landing-links.js';
import { SectionHeader } from './section-header.js';

export type AppsSectionProps = {
  content: LandingContent['apps'];
  links: LandingLinks;
};

function monogram(name: string): string {
  return Array.from(name)[0] ?? '•';
}

export function AppsSection({ content, links }: AppsSectionProps) {
  return (
    <section id="apps" className="section-pad screen-section bg-white">
      <div className="container-nimi">
        <SectionHeader
          title={content.title}
          subtitle={content.subtitle}
          actions={
            <a className="cta-primary" href={links.appsUrl}>
              {content.listCta}
            </a>
          }
        />

        <p className="mt-6 max-w-3xl text-base leading-7 text-slate-600">{content.body}</p>

        <div className="mt-8 space-y-8">
          {content.groups.map((group) => (
            <section key={group.id} aria-labelledby={`apps-group-${group.id}`}>
              <h3
                id={`apps-group-${group.id}`}
                className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400"
              >
                {group.label}
              </h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item) => (
                  <article
                    key={item.id}
                    className="flex flex-col rounded-[1.35rem] border border-slate-200 bg-slate-50 p-5 shadow-[0_16px_42px_-32px_rgba(15,23,42,0.5)] transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-white"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#e8fbf3] to-[#eaf5fe] text-base font-bold text-[#0f766e] ring-1 ring-slate-200"
                      >
                        {monogram(item.name)}
                      </span>
                      <h4 className="text-lg font-semibold tracking-tight text-slate-900">{item.name}</h4>
                    </div>
                    <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{item.task}</p>
                    {item.capabilities.length > 0 ? (
                      <ul className="mt-4 flex flex-wrap gap-2" aria-label={item.name}>
                        {item.capabilities.map((capability) => (
                          <li
                            key={capability}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
                          >
                            {content.capabilityLabels[capability] ?? capability}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <a
                      href={buildAppDetailUrl(links.appsUrl, item.id)}
                      className="mt-5 inline-flex w-fit items-center gap-1 text-sm font-semibold text-[#2ba980] transition hover:text-[#1f8a68]"
                    >
                      {content.itemCta}
                      <span aria-hidden="true">→</span>
                    </a>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-8 max-w-3xl text-sm leading-6 text-slate-500">{content.availabilityNote}</p>
      </div>
    </section>
  );
}

import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { SectionHeader } from './section-header.js';

export type AppsSectionProps = {
  content: LandingContent['apps'];
  links: LandingLinks;
};

function AppsIcon(props: { index: number }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
    className: 'h-6 w-6',
    'aria-hidden': true,
  };

  if (props.index === 1) {
    return (
      <svg {...common}>
        <path d="M12 3v18" />
        <path d="m5 8 7-5 7 5" />
        <path d="M5 16h14" />
        <path d="M7 12h10" />
      </svg>
    );
  }

  if (props.index === 2) {
    return (
      <svg {...common}>
        <path d="M4 7h16" />
        <path d="M4 17h16" />
        <path d="M7 4v16" />
        <path d="M17 4v16" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function AppsSection({ content, links }: AppsSectionProps) {
  return (
    <section id="apps" className="section-pad bg-white">
      <div className="container-nimi">
        <SectionHeader
          kicker={content.eyebrow}
          title={content.title}
          subtitle={content.subtitle}
          actions={
            <a className="cta-primary" href={links.desktopDownloadUrl} target="_blank" rel="noreferrer">
              {content.cta}
            </a>
          }
        />

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {content.cards.map((card, index) => (
            <article
              key={card.title}
              className="reveal rounded-[1.5rem] border border-slate-200 bg-slate-50 p-6 shadow-[0_16px_42px_-28px_rgba(15,23,42,0.45)]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#0ea5e9] shadow-sm ring-1 ring-slate-200">
                <AppsIcon index={index} />
              </div>
              <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-[#2ba980]">
                {card.label}
              </p>
              <h3 className="mt-3 text-xl font-bold tracking-tight text-slate-900">{card.title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">{card.description}</p>
            </article>
          ))}
        </div>

        <div className="mt-6 grid gap-3 rounded-[1.25rem] border border-slate-200 bg-slate-950 p-5 text-sm text-slate-200 md:grid-cols-3">
          {content.notes.map((note) => (
            <p key={note} className="leading-6">
              {note}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

import type { LandingContent } from '../content/landing-content.js';

export type ExperiencesSectionProps = {
  content: LandingContent['experiences'];
};

type CardAccent = {
  chip: string;
  label: string;
  dot: string;
  quoteBorder: string;
};

const ACCENTS: ReadonlyArray<CardAccent> = [
  {
    chip: 'bg-[#38d6a3]/10 text-[#2ba980]',
    label: 'text-[#2ba980]',
    dot: 'bg-[#38d6a3]',
    quoteBorder: 'border-[#38d6a3]/30',
  },
  {
    chip: 'bg-[#0ea5e9]/10 text-[#0284c7]',
    label: 'text-[#0284c7]',
    dot: 'bg-[#0ea5e9]',
    quoteBorder: 'border-[#0ea5e9]/30',
  },
  {
    chip: 'bg-[#8b5cf6]/10 text-[#7c3aed]',
    label: 'text-[#7c3aed]',
    dot: 'bg-[#8b5cf6]',
    quoteBorder: 'border-[#8b5cf6]/30',
  },
];

function CardIcon({ id }: { id: string }) {
  const className = 'h-6 w-6';
  if (id === 'create') {
    return (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
      </svg>
    );
  }
  if (id === 'explore') {
    return (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m-18.432 0A8.959 8.959 0 013 12c0-.778.099-1.533.284-2.253" />
      </svg>
    );
  }
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
    </svg>
  );
}

export function ExperiencesSection(props: ExperiencesSectionProps) {
  return (
    <section id="experiences" className="section-pad relative overflow-hidden bg-white">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent"
        aria-hidden="true"
      />
      <div className="container-nimi">
        <div className="reveal mx-auto max-w-3xl text-center">
          <p className="text-[12px] font-bold uppercase tracking-[0.24em] text-[#2bb28f]">
            {props.content.eyebrow}
          </p>
          <h2 className="mt-4 text-balance text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">
            {props.content.title}
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
            {props.content.subtitle}
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {props.content.cards.map((card, index) => {
            const accent = ACCENTS[index % ACCENTS.length]!;
            return (
              <article
                key={card.id}
                className="reveal flex flex-col rounded-[28px] border border-slate-100 bg-[#fbfdfc] p-8 shadow-[0_10px_36px_-18px_rgba(15,23,42,0.16)] transition-all hover:-translate-y-1 hover:bg-white hover:shadow-[0_22px_48px_-20px_rgba(15,23,42,0.22)]"
              >
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${accent.chip}`}>
                  <CardIcon id={card.id} />
                </div>
                <p className={`mt-6 text-[11px] font-bold uppercase tracking-[0.22em] ${accent.label}`}>
                  {card.label}
                </p>
                <h3 className="mt-2 text-[22px] font-bold leading-snug tracking-tight text-slate-900">
                  {card.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
                  {card.description}
                </p>
                <ul className="mt-5 space-y-2.5">
                  {card.points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-[14px] font-medium text-slate-700">
                      <span className={`mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full ${accent.dot}`} aria-hidden="true" />
                      {point}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-6">
                  <p className={`border-l-2 pl-4 text-[13.5px] italic leading-relaxed text-slate-500 ${accent.quoteBorder}`}>
                    {card.scenario}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

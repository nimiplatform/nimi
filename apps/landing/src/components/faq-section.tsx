import { useState } from 'react';
import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';

export type FaqSectionProps = {
  content: LandingContent['faq'];
  links: LandingLinks;
};

function ChevronIcon() {
  return (
    <svg
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="20"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function FaqSection(props: FaqSectionProps) {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="section-pad pt-10 md:pt-12">
      <div className="container-nimi mx-auto max-w-4xl">
        <div className="mb-16 flex flex-col items-center text-center">
          <p className="text-[12px] font-bold uppercase tracking-[0.24em] text-[#2bb28f]">
            {props.content.eyebrow}
          </p>
          <h2 className="mt-3 max-w-3xl text-balance text-[34px] font-extrabold leading-tight tracking-tight text-slate-900 md:text-[42px]">
            {props.content.title}
          </h2>
          <p className="mt-4 max-w-2xl text-[18px] leading-relaxed text-slate-500">
            {props.content.description}
          </p>
          <a
            href={props.links.discordUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-8 inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md"
          >
            {props.content.communityCta}
          </a>
        </div>

        <div className="mx-auto max-w-3xl space-y-4">
          {props.content.items.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <article
                key={item.question}
                className="rounded-[24px] border border-slate-100 bg-white p-6 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.05)] transition-all hover:shadow-[0_8px_20px_-6px_rgba(0,0,0,0.1)]"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 text-left"
                  aria-expanded={isOpen}
                  onClick={() => setOpenIndex((current) => (current === index ? -1 : index))}
                >
                  <span className="text-[18px] font-bold text-slate-900">
                    {item.question}
                  </span>
                  <span
                    className={`ml-4 flex-shrink-0 rounded-full bg-teal-50/70 p-1 text-teal-500 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                  >
                    <ChevronIcon />
                  </span>
                </button>

                <div
                  className={`grid overflow-hidden pr-8 transition-all duration-300 ease-in-out ${isOpen ? 'mt-4 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                >
                  <div className="min-h-0">
                    <p className="text-base leading-relaxed text-slate-500">
                      {item.answer}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

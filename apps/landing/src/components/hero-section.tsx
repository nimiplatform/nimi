import { useState } from 'react';
import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';

export type HeroSectionProps = {
  content: LandingContent['hero'];
  links: LandingLinks;
};

export function HeroSection(props: HeroSectionProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopyCommand() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(props.content.installCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      className="relative overflow-hidden bg-[#f3efe7] pb-20 pt-24 text-slate-950 md:pb-24 md:pt-32"
      style={{ minHeight: 'calc(100vh - 72px)' }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-[-10rem] top-[-8rem] h-72 w-72 rounded-full bg-[#d97a55]/16 blur-3xl" />
        <div className="absolute right-[-6rem] top-16 h-64 w-64 rounded-full bg-[#ead6b7]/45 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-white/70 blur-3xl" />
      </div>

      <div className="container-nimi relative z-10">
        <div className="reveal mx-auto max-w-5xl text-center">
          <p className="inline-flex rounded-full border border-[#d9d1c6] bg-white/70 px-5 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#d97a55] shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
            {props.content.eyebrow}
          </p>
          <h1 className="mt-8 text-balance font-heading text-5xl font-semibold leading-[0.95] tracking-tight text-slate-950 md:text-7xl">
            {props.content.title}
            {' '}
            <span className="text-[#d97a55]">{props.content.titleAccent}</span>
          </h1>
          <p className="mx-auto mt-8 max-w-4xl text-xl leading-9 text-slate-600 md:text-[2rem] md:leading-[1.45]">
            {props.content.subtitle}
          </p>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-7 text-slate-500 md:text-lg">
            {props.content.description}
          </p>

          <div className="mx-auto mt-12 max-w-5xl rounded-[2rem] border border-[#ddd5c8] bg-[#f8f4ec]/92 p-3 shadow-[0_35px_90px_rgba(31,20,12,0.12)] backdrop-blur">
            <div className="flex flex-col gap-3 lg:flex-row">
              <a
                href={props.links.desktopDownloadUrl}
                className="inline-flex items-center justify-center rounded-[1.2rem] bg-slate-950 px-7 py-4 text-lg font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97a55]"
                target="_blank"
                rel="noreferrer"
              >
                {props.content.primaryCta}
              </a>

              <div className="flex min-w-0 flex-1 items-center gap-3 rounded-[1.2rem] border border-[#e4ded2] bg-white/88 px-5 py-4 text-left">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[0.95rem] text-slate-900 md:text-[1.1rem]">
                  <span className="text-[#d97a55]">curl -fsSL</span>
                  {' '}
                  <span>https://install.nimi.xyz</span>
                  {' '}
                  <span className="text-[#6c9ed0]">| sh</span>
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyCommand();
                  }}
                  className="inline-flex shrink-0 items-center justify-center rounded-xl border border-[#ddd5c8] bg-[#f6f1e8] px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#d97a55]/40 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97a55]"
                >
                  {copied ? props.content.copiedCommandLabel : props.content.copyCommandLabel}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-slate-500 md:text-base">
            <span>
              {props.content.altInstallLabel}
              {' '}
              <code className="rounded-md bg-white/70 px-2 py-1 text-[0.92em] text-slate-700">{props.content.altInstallCommand}</code>
            </span>
            <a
              href={props.links.docsUrl}
              className="font-medium text-slate-600 underline decoration-[#d97a55]/55 underline-offset-4 transition hover:text-slate-950"
              target="_blank"
              rel="noreferrer"
            >
              {props.content.docsCta}
            </a>
            <a
              href={props.links.githubUrl}
              className="font-medium text-slate-600 underline decoration-[#d97a55]/40 underline-offset-4 transition hover:text-slate-950"
              target="_blank"
              rel="noreferrer"
            >
              {props.content.githubCta}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

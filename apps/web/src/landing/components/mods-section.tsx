import type { SVGProps } from 'react';
import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import audioBookLogoUrl from '../assets/mod-logos/audio-book.svg';
import buddyLogoUrl from '../assets/mod-logos/buddy.svg';
import dailyOutfitLogoUrl from '../assets/mod-logos/daily-outfit.svg';
import kismetLogoUrl from '../assets/mod-logos/kismet.svg';
import knowledgeBaseLogoUrl from '../assets/mod-logos/knowledge-base.svg';
import mintYouLogoUrl from '../assets/mod-logos/mint-you.svg';
import textplayLogoUrl from '../assets/mod-logos/textplay.svg';
import videoplayLogoUrl from '../assets/mod-logos/videoplay.svg';
import worldStudioLogoUrl from '../assets/mod-logos/world-studio.svg';

export type ModsSectionProps = {
  content: LandingContent['mods'];
  links: LandingLinks;
};

// Decorative-only logo layout per W7 user A3 selection a tightening.
// 3-depth blur layering visual primitive (D2 keep) preserved via depth tier.
// No name / no label / no clickable detail panel — logos are visual ambient
// only. Stable file ids are component-internal asset identifiers (not
// user-facing strings).
type LogoDepth = 'back' | 'mid' | 'front';
type LogoEntry = { logo: string; depth: LogoDepth };

const LOGO_LAYOUT_TOP: ReadonlyArray<LogoEntry> = [
  { logo: audioBookLogoUrl, depth: 'back' },
  { logo: textplayLogoUrl, depth: 'mid' },
  { logo: kismetLogoUrl, depth: 'front' },
  { logo: videoplayLogoUrl, depth: 'mid' },
  { logo: knowledgeBaseLogoUrl, depth: 'back' },
  { logo: buddyLogoUrl, depth: 'mid' },
];

const LOGO_LAYOUT_BOTTOM: ReadonlyArray<LogoEntry> = [
  { logo: mintYouLogoUrl, depth: 'front' },
  { logo: dailyOutfitLogoUrl, depth: 'front' },
  { logo: worldStudioLogoUrl, depth: 'mid' },
];

const DEPTH_STYLES: Record<LogoDepth, string> = {
  back: 'scale-[0.74] blur-[3px] brightness-[0.6]',
  mid: 'scale-[0.86] blur-[1.3px] brightness-[0.82]',
  front: 'scale-[1.03] shadow-[0_18px_44px_rgba(0,0,0,0.52),0_0_18px_rgba(255,255,255,0.05)]',
};

function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M9 10h.01" />
      <path d="M12 10h.01" />
      <path d="M15 10h.01" />
    </svg>
  );
}

function SimIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 19h16" />
      <path d="M7 15V9" />
      <path d="M12 15V5" />
      <path d="M17 15v-3" />
    </svg>
  );
}

function StoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function DocsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function ModGlyph(props: { icon: string; className?: string }) {
  switch (props.icon) {
    case 'chat':
      return <ChatIcon className={props.className} />;
    case 'sim':
      return <SimIcon className={props.className} />;
    case 'story':
      return <StoryIcon className={props.className} />;
    case 'docs':
      return <DocsIcon className={props.className} />;
    default:
      return <span className={props.className}>{props.icon}</span>;
  }
}

export function ModsSection(props: ModsSectionProps) {
  return (
    <section
      id="mods"
      className="relative overflow-hidden bg-[radial-gradient(circle_at_top_center,#0a0a10_0%,#000000_100%)] px-4 py-24 text-white sm:px-6 lg:px-8 lg:py-28"
    >
      <div className="pointer-events-none absolute left-1/2 top-[28%] h-[31rem] w-[50rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[linear-gradient(135deg,rgba(16,185,129,0.24)_0%,rgba(59,130,246,0.24)_100%)] blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-16%] left-[-18%] h-[38vh] w-[68vw] rounded-[60%_40%_30%_70%/60%_30%_70%_40%] bg-[radial-gradient(ellipse_at_center,rgba(30,60,90,0.38)_0%,transparent_70%)] opacity-60 blur-[100px]" />
      <div className="pointer-events-none absolute bottom-[-10%] right-[-10%] h-[34vh] w-[58vw] rounded-[40%_60%_70%_30%/40%_50%_60%_50%] bg-[radial-gradient(ellipse_at_center,rgba(20,70,80,0.3)_0%,transparent_70%)] opacity-60 blur-[100px]" />

      <div className="container-nimi relative z-10">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#63f0cf]">
            {props.content.eyebrow}
          </p>
          <h2 className="mt-6 bg-[linear-gradient(180deg,#ffffff_0%,#a0a0a0_100%)] bg-clip-text font-heading text-4xl font-bold tracking-[-0.04em] text-transparent sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
            {props.content.title}
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-[#888890]">
            {props.content.subtitle}
          </p>
        </div>

        {/* Decorative logo wall — 3-depth blur layering visual primitive preserved.
            All logos alt="" + aria-hidden="true" per W7 user A3 selection a:
            no mod.name in DOM, no clickable detail panel, no ARIA name reference. */}
        <div
          className="mt-16 flex flex-col items-center gap-7"
          aria-hidden="true"
        >
          <div className="flex flex-wrap items-center justify-center gap-4 lg:flex-nowrap">
            {LOGO_LAYOUT_TOP.map((entry, index) => (
              <div
                key={`top-${index}`}
                className={`relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#101015] transition-transform duration-500 ${DEPTH_STYLES[entry.depth]} sm:h-28 sm:w-28 lg:h-32 lg:w-32`}
              >
                <img
                  src={entry.logo}
                  alt=""
                  aria-hidden="true"
                  className="h-[68%] w-[68%] object-contain"
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 lg:flex-nowrap">
            {LOGO_LAYOUT_BOTTOM.map((entry, index) => (
              <div
                key={`bottom-${index}`}
                className={`relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#101015] transition-transform duration-500 ${DEPTH_STYLES[entry.depth]} sm:h-28 sm:w-28 lg:h-32 lg:w-32`}
              >
                <img
                  src={entry.logo}
                  alt=""
                  aria-hidden="true"
                  className="h-[68%] w-[68%] object-contain"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Capability framing — content tree mods.items[] (3 generic capability
            items per C-MOD-CAPABILITIES; no named-mod claims per
            C-NAMED-MOD-CATALOG forbidden). */}
        <div className="mx-auto mt-20 grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
          {props.content.items.map((item) => (
            <div
              key={item.name}
              className="flex flex-col items-start rounded-2xl border border-white/8 bg-white/[0.03] p-7 backdrop-blur-md transition-colors hover:border-white/20 hover:bg-white/[0.05]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#63f0cf]/10 text-[#63f0cf]">
                <ModGlyph icon={item.icon} className="h-6 w-6" />
              </div>
              <h3 className="mt-5 text-xl font-bold tracking-tight text-white">{item.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#9ca3af]">{item.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 flex justify-center">
          <a
            href={props.links.docsUrl + 'desktop/mod-system'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.06] px-6 py-3 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/10"
          >
            {props.content.buildModCta}
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}

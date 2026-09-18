import type { HeroDemo } from '../content/landing-content.js';

/**
 * Static, size-stable stand-in for the interactive desktop preview: rendered
 * while the demo chunk loads, and as the local error fallback if loading
 * fails. It intentionally shares no imports with the lazy demo chunk so a
 * chunk failure cannot take it down.
 */
export function HeroDemoStatic({ demo }: { demo: HeroDemo }) {
  return (
    <div className="hero-demo-frame overflow-hidden rounded-[1.5rem] border border-white/70 bg-gradient-to-b from-[#fbe9f0] via-[#eef2fd] to-[#e9eefb] shadow-[0_24px_60px_-32px_rgba(15,23,42,0.45)] lg:rounded-[1.75rem]">
      <div className="flex items-center gap-2 border-b border-white/60 bg-white/50 px-5 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#fca5a5]" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#fcd34d]" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#6ee7b7]" aria-hidden="true" />
        <span className="ml-2 text-sm font-semibold tracking-tight text-slate-700">{demo.windowTitle}</span>
      </div>
      <div className="flex h-[560px] flex-col items-center justify-center px-6 text-center md:h-[650px] lg:h-[780px]">
        <p className="text-base font-semibold tracking-tight text-slate-700 md:text-lg">
          {demo.chat.greeting}
        </p>
        <div className="mt-6 w-full max-w-xl rounded-3xl bg-white/90 px-5 py-4 shadow-[0_18px_44px_-30px_rgba(15,23,42,0.5)]">
          <span className="block text-left text-sm text-slate-400">{demo.chat.inputPlaceholder}</span>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-400">{demo.chat.inputNote}</p>
      </div>
    </div>
  );
}

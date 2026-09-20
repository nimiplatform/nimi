import type { HeroDemo } from '../content/landing-content.js';

/**
 * Static, size-stable stand-in for the interactive desktop preview: rendered
 * while the demo chunk loads, and as the local error fallback if loading
 * fails. It intentionally shares no imports with the lazy demo chunk so a
 * chunk failure cannot take it down. The window chrome comes from the
 * .hero-demo-frame / .hero-demo-titlebar rules, shared with the live demo
 * through CSS rather than code.
 */
export function HeroDemoStatic({
  demo,
  surface = 'chat',
  expanded = false,
}: {
  demo: HeroDemo;
  surface?: 'chat' | 'apps';
  expanded?: boolean;
}) {
  const frameClass = expanded
    ? 'hero-demo-frame flex h-full min-h-0 flex-col'
    : 'hero-demo-frame';
  const bodyClass = expanded
    ? 'flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center'
    : 'flex h-[520px] flex-col items-center justify-center px-6 text-center md:h-[620px] lg:h-[min(720px,80vh)] xl:h-[min(780px,82vh)] 2xl:h-[min(840px,84vh)]';
  const placeholderClass = 'mt-6 w-full max-w-xl rounded-control border border-slate-200 bg-white px-5 py-4';
  return (
    <div className={frameClass}>
      <div className="hero-demo-titlebar flex shrink-0 items-center gap-2 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#fca5a5]" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#fcd34d]" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#6ee7b7]" aria-hidden="true" />
        <span className="ml-2 text-sm font-semibold tracking-tight text-slate-700">{demo.windowTitle}</span>
      </div>
      {surface === 'apps' ? (
        <div className={bodyClass}>
          <p className="text-base font-semibold tracking-tight text-slate-700 md:text-lg">
            {demo.apps.title}
          </p>
          <div className={placeholderClass}>
            <span className="block text-left text-sm text-slate-400">{demo.apps.searchPlaceholder}</span>
          </div>
        </div>
      ) : (
        <div className={bodyClass}>
          <p className="text-base font-semibold tracking-tight text-slate-700 md:text-lg">
            {demo.chat.greeting}
          </p>
          <div className={placeholderClass}>
            <span className="block text-left text-sm text-slate-400">{demo.chat.inputPlaceholder}</span>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-slate-400">{demo.chat.inputNote}</p>
        </div>
      )}
    </div>
  );
}

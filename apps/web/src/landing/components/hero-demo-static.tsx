import type { HeroDemo } from '../content/landing-content.js';
import type { ReactNode } from 'react';
import { DemoWindowHeader, type DemoWindowClose } from './demo-window-header.js';

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
  surface = 'home',
  expanded = false,
  windowTitle,
  windowActions,
  windowClose,
}: {
  demo: HeroDemo;
  surface?: 'home' | 'chat' | 'apps' | 'explore';
  expanded?: boolean;
  windowTitle?: string;
  windowActions?: ReactNode;
  windowClose?: DemoWindowClose;
}) {
  const frameClass = expanded ? 'hero-demo-frame flex h-full min-h-0 flex-col' : 'hero-demo-frame';
  const bodyClass = expanded
    ? 'flex min-h-0 flex-1 flex-col items-center justify-start px-6 pt-10 text-center md:justify-center md:pt-0'
    : 'flex h-[520px] flex-col items-center justify-center px-6 text-center md:h-[620px] lg:h-[min(720px,80vh)] xl:h-[min(780px,82vh)] 2xl:h-[min(840px,84vh)]';
  const placeholderClass = 'mt-6 w-full max-w-xl rounded-control border border-slate-200 bg-white px-5 py-4';
  const heading =
    surface === 'apps'
      ? demo.apps.title
      : surface === 'explore'
        ? demo.nav.explore
        : surface === 'chat'
          ? demo.chat.greeting
          : demo.home.greeting;
  const placeholder =
    surface === 'apps'
      ? demo.apps.searchPlaceholder
      : surface === 'explore'
        ? demo.home.explore
        : surface === 'chat'
          ? demo.chat.inputPlaceholder
          : demo.home.recent;
  return (
    <div className={frameClass}>
      <DemoWindowHeader title={windowTitle ?? demo.windowTitle} close={windowClose}>
        <span className="demo-preview-badge ml-auto">{demo.home.badge}</span>
        {windowActions}
      </DemoWindowHeader>
      <div className={bodyClass}>
        <p className="text-base font-semibold tracking-tight text-slate-700 md:text-lg">
          {heading}
        </p>
        <div className={placeholderClass}>
          <span className="block text-left text-sm text-slate-400">
            {placeholder}
          </span>
        </div>
      </div>
    </div>
  );
}

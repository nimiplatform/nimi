import { lazy, Suspense, useEffect, useState } from 'react';
import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';

// Lazy-load Three.js hero scene so its bundle stays out of the initial entry
// chain. Per W2 design + L11 + D3.5 perf budget.
const HeroScene = lazy(() =>
  import('./hero-scene.js').then((module) => ({ default: module.HeroScene })),
);

export type HeroSectionProps = {
  content: LandingContent['hero'];
  links: LandingLinks;
};

/**
 * Detect whether the ambient hero scene should be mounted.
 * Returns false on:
 *  - mobile viewports (<768px) → static gradient is enough
 *  - prefers-reduced-motion: reduce → respect motion preference
 *  - no window (SSR / initial render) → wait for client mount
 */
function useShouldMountHeroScene(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const desktopQuery = window.matchMedia('(min-width: 768px)');
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const evaluate = () => {
      setEnabled(desktopQuery.matches && !motionQuery.matches);
    };

    evaluate();
    desktopQuery.addEventListener('change', evaluate);
    motionQuery.addEventListener('change', evaluate);

    return () => {
      desktopQuery.removeEventListener('change', evaluate);
      motionQuery.removeEventListener('change', evaluate);
    };
  }, []);

  return enabled;
}

export function HeroSection(props: HeroSectionProps) {
  const sceneEnabled = useShouldMountHeroScene();

  return (
    <section
      id="hero"
      className="relative overflow-hidden bg-transparent pb-36 pt-24 text-slate-900 md:pb-40 md:pt-32"
    >
      {/* Layer z=0: ambient background. Three.js scene on desktop+motion;
          static gradient on mobile / reduced-motion / pre-mount. Scene is
          positioned upper-right outside the centered content column so dark
          galaxy contrast doesn't interfere with the headline copy. */}
      <div
        className="pointer-events-none absolute inset-0 -z-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-[#e8fbf3] via-[#eaf5fe] to-[#f4ecff]" />
        <div className="absolute left-[-10rem] top-[-8rem] h-72 w-72 rounded-full bg-[#38d6a3]/10 blur-3xl" />
        <div className="absolute right-[-6rem] top-16 h-64 w-64 rounded-full bg-[#0ea5e9]/10 blur-3xl" />
        {sceneEnabled ? (
          <Suspense fallback={null}>
            <div className="absolute right-[-30%] top-[-40%] h-[110%] w-[55%] overflow-hidden opacity-50 [mask-image:radial-gradient(closest-side,black_30%,transparent_75%)]">
              <div className="absolute inset-0 bg-[radial-gradient(closest-side,#040c1c_50%,transparent_100%)]" />
              <div className="absolute inset-0">
                <HeroScene />
              </div>
            </div>
          </Suspense>
        ) : null}
      </div>

      {/* Layer z=10: content */}
      <div className="container-nimi relative z-10">
        <div className="reveal mx-auto max-w-[1200px] text-center">
          {props.content.eyebrow ? (
            <p className="mx-auto inline-flex rounded-full border border-slate-200/70 bg-white/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-sm nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]">
              {props.content.eyebrow}
            </p>
          ) : null}
          <h1 className="mt-6 font-heading text-5xl font-semibold leading-[0.95] tracking-tight text-slate-900 md:text-7xl">
            <span className="block text-balance text-slate-900">
              {props.content.title}
            </span>
            <span className="mt-2 block text-balance">
              <span className="bg-gradient-to-r from-[#38d6a3] to-[#0ea5e9] bg-clip-text text-transparent">
                {props.content.titleAccent}
              </span>
            </span>
          </h1>
          <p className="mx-auto mt-8 max-w-4xl text-xl leading-9 text-slate-600 md:text-[2rem] md:leading-[1.45]">
            {props.content.subtitle}
          </p>

          <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href={props.links.downloadUrl}
              className="inline-flex min-w-44 items-center justify-center rounded-full bg-gradient-to-r from-[#38d6a3] to-[#0ea5e9] px-7 py-3.5 text-base font-bold text-white shadow-[0_16px_34px_-14px_rgba(14,165,233,0.7)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-14px_rgba(14,165,233,0.8)]"
            >
              {props.content.primaryCta}
            </a>
            <a
              href="#architecture"
              className="inline-flex min-w-44 items-center justify-center rounded-full border border-slate-300 bg-white/75 px-7 py-3.5 text-base font-bold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-white"
            >
              {props.content.secondaryCta}
            </a>
          </div>

          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm font-semibold text-slate-600">
            {props.content.proofPoints.map((point) => (
              <li key={point} className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

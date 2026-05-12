import { lazy, Suspense, useEffect, useState } from 'react';
import quickstartPreview from '../../../../../docs/assets/nimi-quickstart.gif';
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
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const sceneEnabled = useShouldMountHeroScene();

  const currentTab = props.content.tabs[activeTab] || props.content.tabs[0]!;

  async function handleCopyCommand() {
    if (typeof navigator === 'undefined' || !navigator.clipboard || !currentTab?.command) {
      return;
    }

    try {
      await navigator.clipboard.writeText(currentTab.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

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

          {/* Get Started 2-Column Card */}
          <div className="mx-auto mt-16 max-w-[1200px] text-left">
            <div className="card-surface shadow-[0_30px_80px_-15px_rgba(0,0,0,0.08),_0_0_40px_rgba(0,0,0,0.03)] grid overflow-hidden md:grid-cols-5 p-0 rounded-2xl bg-white border border-slate-200/60">
              {/* Left Column: Choose your path */}
              <div className="p-8 md:p-10 flex flex-col justify-between md:col-span-2">
                <div>
                  <h2 className="text-3xl font-bold text-slate-900 tracking-tight">{props.content.getStartedTitle}</h2>
                  <p className="mt-2 text-slate-500 font-medium">{props.content.getStartedSubtitle}</p>

                  <div className="mt-8 flex flex-wrap gap-2">
                    {props.content.tabs.map((tab, idx) => {
                      const isActive = activeTab === idx;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => {
                            setActiveTab(idx);
                            setCopied(false);
                          }}
                          className={`rounded-full px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 ${
                            isActive
                              ? 'bg-teal-100 text-teal-800'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-8 h-14">
                    {currentTab.command ? (
                      <div className="flex h-full items-center justify-between rounded-xl bg-slate-900 px-4 text-sm text-slate-300">
                        <code className="font-mono">{currentTab.command}</code>
                        <button
                          type="button"
                          onClick={() => {
                            void handleCopyCommand();
                          }}
                          className="ml-4 rounded hover:text-white focus:outline-none transition group"
                          title={props.content.copyTooltipLabel}
                        >
                          {copied ? (
                            <svg className="h-5 w-5 text-[#38d6a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="h-5 w-5 opacity-70 group-hover:opacity-100 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-8">
                  <a
                    href={props.links.docsUrl + currentTab.id + '/'}
                    className="inline-flex w-full items-center justify-center rounded-xl bg-[#38d6a3] px-6 py-4 text-center font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#2ba980]"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {currentTab.ctaText}
                  </a>

                  <div className="mt-6 text-center text-sm font-medium text-slate-400">
                    {props.content.helperPrefix}{' '}
                    <a href={props.links.docsUrl} className="ml-[0.75rem] hover:text-slate-600 underline decoration-slate-300 underline-offset-4 mr-[0.625rem] transition" target="_blank" rel="noreferrer">{props.content.helperDocsCta}</a>
                    <a href={props.links.githubUrl} className="hover:text-slate-600 underline decoration-slate-300 underline-offset-4 transition" target="_blank" rel="noreferrer">{props.content.helperGithubCta}</a>
                  </div>
                </div>
              </div>

              {/* Right Column: Walkthrough preview */}
              <div className="relative flex min-h-[320px] items-center justify-center overflow-hidden border-t border-slate-200 bg-white p-2 md:col-span-3 md:border-t-0 md:p-3 lg:p-4">
                <div className="relative flex aspect-video w-full max-w-[780px] items-center justify-center overflow-hidden rounded-[1.1rem]">
                  <img
                    src={quickstartPreview}
                    alt={props.content.previewAlt}
                    loading="lazy"
                    decoding="async"
                    className="block h-full w-full object-contain object-center"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

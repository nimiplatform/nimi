import type { LandingLinks } from '../config/landing-links.js';
import type { LandingContent } from '../content/landing-content.js';

export type SdkSectionProps = {
  content: LandingContent['sdk'];
  links: LandingLinks;
};

const CODE_LINES = [
  'const client = createNimiClient({ runtime });',
  '',
  'const agent = await client.agents.connect({',
  "  worldId: 'realm/main',",
  '  context: agentContext,',
  '});',
  '',
  'for await (const event of agent.tasks.stream()) {',
  '  syncState(event);',
  '}',
] as const;

export function SdkSection(props: SdkSectionProps) {
  return (
    <section id="sdk" className="relative overflow-hidden bg-slate-50 text-slate-900">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#f8fafc_0%,#eef8fb_50%,#f8fafc_100%)]" />
        <div className="absolute right-[8%] top-28 h-80 w-80 rounded-full bg-cyan-300/24 blur-3xl" />
        <div className="absolute right-[18%] top-52 h-60 w-60 rounded-full bg-emerald-300/18 blur-2xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid min-h-[calc(100vh-8rem)] items-center gap-8 py-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14 lg:py-12">
          <div className="max-w-2xl">
            {props.content.eyebrow ? (
              <p className="inline-flex rounded-full border border-slate-200/80 bg-white/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-sm">
                {props.content.eyebrow}
              </p>
            ) : null}

            <h2 className="mt-5 text-4xl font-extrabold leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl">
              <span className="block text-slate-950">{props.content.title}</span>
              <span className="mt-2 block bg-gradient-to-r from-emerald-500 to-blue-500 bg-clip-text text-transparent">
                {props.content.titleAccent}
              </span>
            </h2>

            <p className="mt-5 max-w-xl text-base font-medium leading-7 text-slate-600 lg:text-lg lg:leading-8">
              {props.content.subtitle}
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a href={props.links.docsUrl + 'sdk/'} target="_blank" rel="noreferrer" className="cta-primary">
                {props.content.primaryCta}
              </a>
              <a
                href={props.links.githubUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white/76 px-5 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              >
                {props.content.secondaryCta}
              </a>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {props.content.heroHighlights.map((item) => (
                <article
                  key={item.title}
                  className="rounded-lg border border-slate-200/80 bg-white/[0.76] p-3.5 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.45)] backdrop-blur"
                >
                  <h3 className="text-sm font-bold text-slate-950">{item.title}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">{item.description}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-8 rounded-[2rem] bg-[radial-gradient(circle_at_65%_45%,rgba(34,211,238,0.22),rgba(16,185,129,0.10)_42%,transparent_70%)] blur-2xl" />
            <div className="relative overflow-hidden rounded-[1.35rem] border border-slate-900/10 bg-slate-950 shadow-[0_34px_90px_-40px_rgba(15,23,42,0.95)]">
              <div className="flex items-center justify-between border-b border-white/10 bg-slate-900 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-[#ff5f57]" aria-hidden="true" />
                  <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" aria-hidden="true" />
                  <span className="h-3 w-3 rounded-full bg-[#28c840]" aria-hidden="true" />
                </div>
                <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {props.content.codeWindowTitle}
                </p>
              </div>

              <div className="grid gap-4 p-4 sm:p-5">
                <div className="flex flex-wrap gap-2">
                  {props.content.runtimeBadges.map((badge) => (
                    <span
                      key={badge}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-cyan-100"
                    >
                      {badge}
                    </span>
                  ))}
                </div>

                <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/28 p-4 text-[0.8125rem] leading-6 text-slate-200 sm:text-sm">
                  <code>
                    {CODE_LINES.map((line, index) => (
                      <span key={`${index}-${line}`} className="block">
                        <span className="mr-4 select-none text-slate-600">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span>{line || ' '}</span>
                      </span>
                    ))}
                  </code>
                </pre>

                <div className="flex flex-col gap-3 border-t border-white/10 pt-3 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-md leading-6">{props.content.codeWindowCaption}</p>
                  <a
                    href={props.links.docsUrl + 'sdk/'}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center font-semibold text-emerald-300 transition hover:text-emerald-200"
                  >
                    {props.content.callout}
                    <span className="ml-1" aria-hidden="true">
                      -&gt;
                    </span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200/80 py-16 lg:py-20">
          <div className="mb-9 max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-600">
              {props.content.matrixEyebrow}
            </p>
            <h3 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
              {props.content.matrixTitle}
            </h3>
            <p className="mt-4 text-base leading-7 text-slate-600">{props.content.matrixSubtitle}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {props.content.capabilityMatrix.map((item) => (
              <a
                key={item.docsPath}
                href={props.links.docsUrl + item.docsPath}
                target="_blank"
                rel="noreferrer"
                className="group rounded-lg border border-slate-200 bg-white/[0.82] p-5 shadow-[0_18px_46px_-34px_rgba(15,23,42,0.55)] transition hover:-translate-y-1 hover:border-emerald-200 hover:bg-white hover:shadow-[0_24px_60px_-34px_rgba(14,165,233,0.35)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <h4 className="text-base font-bold text-slate-950">{item.title}</h4>
                  <span className="text-sm font-bold text-emerald-500 transition group-hover:translate-x-0.5" aria-hidden="true">
                    -&gt;
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-500">{item.description}</p>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import type { LandingLocale } from '../i18n/locale.js';

export type OpenSourceSectionProps = {
  content: LandingContent['openSource'];
  links: LandingLinks;
  locale: LandingLocale;
};

type ProofItem = {
  label: string;
  value: string;
  detail: string;
  icon: 'runtime' | 'apps' | 'contracts';
  featured?: boolean;
};

function ProofIcon(props: { icon: ProofItem['icon'] }) {
  if (props.icon === 'runtime') {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    );
  }

  if (props.icon === 'apps') {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
        <path d="M3 9h18" />
        <path d="M9 9v12" />
      </svg>
    );
  }

  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 2 10 5-10 5L2 7l10-5Z" />
      <path d="m2 12 10 5 10-5" />
      <path d="m2 17 10 5 10-5" />
    </svg>
  );
}

export function OpenSourceSection(props: OpenSourceSectionProps) {
  const isChinese = props.locale === 'zh';
  const proofItems: ProofItem[] = isChinese
    ? [
        {
          label: '\u8FD0\u884C\u65F6 + SDK',
          value: 'Apache-2.0',
          detail: '\u6838\u5FC3 runtime \u548C SDK \u53EF\u4EE5\u88AB\u76F4\u63A5\u67E5\u770B\u4E0E\u5BA1\u89C6\u3002',
          icon: 'runtime',
        },
        {
          label: '\u5E94\u7528\u5C42',
          value: 'MIT',
          detail: '\u684C\u9762\u7AEF\u548C app \u5C42\u4EE3\u7801\u4EE5\u5BBD\u677E\u8BB8\u53EF\u65B9\u5F0F\u53D1\u5E03\u3002',
          icon: 'apps',
        },
        {
          label: '\u5408\u7EA6',
          value: '\u516C\u5F00',
          detail: '\u6258\u7BA1\u4E91\u96C6\u6210\u4ECD\u7136\u901A\u8FC7 SDK \u63A5\u53E3\u5BF9\u5916\u53EF\u89C1\u3002',
          icon: 'contracts',
          featured: true,
        },
      ]
    : [
        {
          label: 'Runtime + SDK',
          value: 'Apache-2.0',
          detail: 'Core runtime and SDK stay open and inspectable.',
          icon: 'runtime',
        },
        {
          label: 'Apps',
          value: 'MIT',
          detail: 'Desktop and app-layer code ship with permissive licensing.',
          icon: 'apps',
        },
        {
          label: 'Contracts',
          value: 'Public',
          detail: 'Managed cloud integration stays visible through the SDK surface.',
          icon: 'contracts',
          featured: true,
        },
      ];

  return (
    <section id="open-source" className="section-pad">
      <div className="container-nimi">
        <div className="reveal overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white shadow-[0_30px_80px_-24px_rgba(15,23,42,0.18)]">
          <div className="flex flex-col lg:min-h-[35rem] lg:flex-row">
            <div className="relative isolate flex-1 overflow-hidden bg-[#020617] px-8 py-12 text-white sm:px-10 lg:px-12 lg:py-16">
              <div className="absolute inset-0 -z-20 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:40px_40px] opacity-70 [mask-image:radial-gradient(circle_at_center,black_28%,transparent_78%)] [-webkit-mask-image:radial-gradient(circle_at_center,black_28%,transparent_78%)]" />
              <div className="absolute inset-[-45%] -z-10 animate-[spin_18s_linear_infinite] bg-[radial-gradient(circle_at_50%_50%,rgba(20,184,166,0.18),transparent_26%),radial-gradient(circle_at_28%_72%,rgba(14,165,233,0.18),transparent_28%)]" />
              <div className="absolute left-10 top-10 h-24 w-24 rounded-full border border-white/10 bg-white/[0.03] blur-xl" />
              <div className="absolute bottom-16 right-10 h-32 w-32 rounded-full bg-cyan-400/10 blur-3xl" />

              <div className="relative z-10 flex h-full max-w-[31rem] flex-col justify-center">
                <p className="text-sm font-semibold tracking-[0.18em] text-sky-300 uppercase">
                  {props.content.subtitle}
                </p>
                <h2 className="mt-5 font-heading text-4xl font-bold tracking-[-0.04em] text-white sm:text-5xl xl:text-[3.35rem] xl:leading-[1.02]">
                  {props.content.title}
                </h2>
                <p className="mt-6 max-w-[28rem] text-[1.02rem] leading-8 text-slate-300 sm:text-lg">
                  {props.content.description}
                </p>

                <div className="mt-10 flex flex-wrap gap-4">
                  <a
                    className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-teal-500 to-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_12px_26px_-10px_rgba(14,165,233,0.65)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_30px_-10px_rgba(14,165,233,0.75)]"
                    href={props.links.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {props.content.githubCta}
                  </a>
                  <a
                    className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/6 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
                    href={props.links.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {props.content.docsCta}
                  </a>
                </div>
              </div>
            </div>

            <div className="flex-[1.2] bg-slate-50 p-5 sm:p-6 lg:p-8">
              <div className="grid h-full grid-cols-1 gap-5 md:grid-cols-2">
                {proofItems.map((item) => (
                  <article
                    key={item.label}
                    className={[
                      'group relative flex min-h-[16rem] flex-col justify-center overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white p-7 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.35)] transition duration-300 hover:-translate-y-1 hover:border-sky-200 hover:shadow-[0_24px_40px_-18px_rgba(15,23,42,0.18)]',
                      item.featured ? 'md:col-span-2 md:flex-row md:items-center md:justify-between md:gap-8' : '',
                    ].join(' ')}
                  >
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-200 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                    <div
                      className={[
                        'mb-6 flex h-12 w-12 items-center justify-center rounded-[0.95rem] bg-slate-100 text-slate-900 transition duration-300 group-hover:scale-110 group-hover:bg-sky-50 group-hover:text-sky-600',
                        item.featured ? 'md:mb-0 md:h-16 md:w-16 md:shrink-0' : '',
                      ].join(' ')}
                    >
                      <ProofIcon icon={item.icon} />
                    </div>

                    <div className={item.featured ? 'flex-1' : ''}>
                      <p className="text-[0.72rem] font-bold uppercase tracking-[0.18em] text-teal-600">
                        {item.label}
                      </p>
                      <h3 className="mt-3 font-mono text-[1.8rem] font-bold tracking-[-0.04em] text-slate-900 sm:text-[2rem]">
                        {item.value}
                      </h3>
                      <p className="mt-4 max-w-[28rem] text-sm leading-7 text-slate-500">
                        {item.detail}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import type { LandingLocale } from '../i18n/locale.js';

export type DesktopSectionProps = {
  content: LandingContent['desktop'];
  links: LandingLinks;
  locale: LandingLocale;
};

export function DesktopSection(props: DesktopSectionProps) {
  const [primaryFeature, secondaryFeature, tertiaryFeature, quaternaryFeature] = props.content.features;
  const isChinese = props.locale === 'zh';
  const chromeLabels = isChinese
    ? {
        appName: 'Nimi Desktop',
        runtime: 'Runtime',
        health: '状态正常',
        healthDetail: 'gRPC 已就绪，本地 runtime 已连接。',
        workspace: '工作区',
        activity: '活动',
        ready: '就绪',
        connected: '已连接',
        installed: '已安装',
      }
    : {
        appName: 'Nimi Desktop',
        runtime: 'Runtime',
        health: 'Health: OK',
        healthDetail: 'gRPC ready. Local runtime connected.',
        workspace: 'Workspace',
        activity: 'Activity',
        ready: 'Ready',
        connected: 'Connected',
        installed: 'Installed',
      };

  const featureIcons = [
    <svg key="1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-[#4ade80]">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>,
    <svg key="2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-[#4ade80]">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
    </svg>,
    <svg key="3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-[#4ade80]">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-.86-1.875-1.915-1.875s-1.915.84-1.915 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a1.5 1.5 0 01-1.5 1.5h-.53c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875.86-1.875 1.915s.84 1.915 1.875 1.915c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401h0a1.5 1.5 0 011.5 1.5v.53c0 .355-.186.676-.401.959-.221.29-.349.634-.349 1.003 0 1.036.86 1.875 1.915 1.875s1.915-.84 1.915-1.875c0-.369-.128-.713-.349-1.003-.215-.283-.401-.604-.401-.959v0a1.5 1.5 0 011.5-1.5h.53c.355 0 .676.186.959.401.29.221.634.349 1.003.349 1.036 0 1.875-.86 1.875-1.915s-.84-1.915-1.875-1.915a1.647 1.647 0 00-1.003.349c-.283.215-.604.401-.959.401h0a1.5 1.5 0 01-1.5-1.5z" />
    </svg>,
    <svg key="4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-[#4ade80]">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
    </svg>,
  ];

  return (
    <section id="desktop" className="section-pad relative overflow-hidden bg-[#f4fbfa]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#e1fbef] via-[#e2fafe] to-[#e8f2fe] opacity-80" />

      <div className="container-nimi relative z-10 mx-auto max-w-[1060px]">
        <div className="reveal relative flex flex-col rounded-[24px] border border-white bg-white shadow-[0_20px_50px_-15px_rgba(45,212,191,0.1),_0_0_40px_rgba(0,0,0,0.03)] xl:min-h-[480px] xl:flex-row">
          <div className="flex flex-col justify-center p-10 md:p-14 lg:p-16 xl:w-[42%] xl:pr-10 2xl:w-[45%]">
            <h3 className="text-[42px] font-bold leading-[1.12] tracking-tight text-slate-900 md:text-5xl">
              {props.content.title}
            </h3>
            <p className="mt-5 max-w-[340px] text-[17px] font-medium leading-relaxed text-slate-600">
              {props.content.subtitle}
            </p>
            <div className="mt-8">
              <a
                className="inline-flex h-[52px] items-center justify-center rounded-[20px] bg-gradient-to-r from-[#38d6a3] to-[#0ea5e9] px-8 text-[15px] font-bold text-white shadow-[0_12px_30px_-10px_rgba(56,214,163,0.5)] transition hover:-translate-y-1 hover:shadow-[0_16px_40px_-10px_rgba(56,214,163,0.6)]"
                href={props.links.desktopDownloadUrl}
                target="_blank"
                rel="noreferrer"
              >
                {props.content.downloadCta}
              </a>
            </div>
          </div>

          <div className="relative flex min-h-[320px] items-center justify-center px-6 pb-8 pt-2 md:min-h-[380px] md:px-8 md:pb-10 xl:w-[58%] xl:justify-start xl:px-6 xl:pb-8 xl:pt-8 2xl:w-[55%] 2xl:justify-end 2xl:px-8 2xl:pb-8 2xl:pt-8 2xl:pr-14">
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-[#38d6a3]/10 to-[#0ea5e9]/10 blur-[60px] md:h-[500px] md:w-[500px]" />

            <div
              className="relative z-10 w-full max-w-[720px] rounded-[22px] p-[6px] shadow-[0_40px_80px_-15px_rgba(0,0,0,0.35),_inset_0_1px_1px_rgba(255,255,255,0.4)] backdrop-blur-[24px] xl:w-[calc(100%+2rem)] xl:max-w-[700px] xl:-translate-x-[4%] 2xl:absolute 2xl:right-[-12%] 2xl:top-[54%] 2xl:w-full 2xl:max-w-[620px] 2xl:-translate-y-[40%] 2xl:translate-x-0"
              style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.02) 100%)' }}
            >
              <div className="h-full w-full overflow-hidden rounded-[16px] bg-[#1a1c23] shadow-2xl ring-1 ring-white/10">
                <div className="flex h-10 items-center justify-between border-b border-black/30 bg-[#20232b] px-4">
                  <div className="flex gap-[6px]">
                    <div className="h-[10px] w-[10px] rounded-full border border-[#d04a40] bg-[#ec6a5e]" />
                    <div className="h-[10px] w-[10px] rounded-full border border-[#d6a241] bg-[#f4bf4f]" />
                    <div className="h-[10px] w-[10px] rounded-full border border-[#4a9f3d] bg-[#61c554]" />
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6b7280]">
                    {chromeLabels.appName}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 bg-[#171920] p-5 md:grid-cols-[1.1fr_1.3fr]">
                  <div className="flex flex-col gap-[14px]">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#4ade80]">{chromeLabels.runtime}</p>

                    <div className="relative overflow-hidden rounded-[14px] border border-[#4ade80]/20 bg-[#4ade80]/[0.08] p-4 ring-[0.5px] ring-[#4ade80]/10">
                      <p className="relative text-[14px] font-bold text-[#4ade80]">{chromeLabels.health}</p>
                      <p className="relative mt-1 text-[11px] font-medium text-[#4ade80]/80">{chromeLabels.healthDetail}</p>
                    </div>

                    <div className="rounded-[14px] border border-white/5 bg-[#20232b] p-4 transition-colors">
                      <p className="text-[13px] font-bold text-slate-200">{primaryFeature?.title || 'Runtime Dashboard'}</p>
                      <p className="mt-[6px] text-[11px] font-medium leading-[1.5] text-[#868d9a]">{primaryFeature?.description || 'See health, model status, and resource usage at a glance.'}</p>
                    </div>

                    <div className="rounded-[14px] border border-white/5 bg-[#20232b] p-4 transition-colors">
                      <p className="text-[13px] font-bold text-slate-200">{quaternaryFeature?.title || 'Model Management'}</p>
                      <p className="mt-[6px] text-[11px] font-medium leading-[1.5] text-[#868d9a]">{quaternaryFeature?.description || 'Install, update, and switch models from one place.'}</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-[14px]">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#38bdf8]">{chromeLabels.workspace}</p>
                      <div className="grid grid-cols-2 gap-[14px]">
                        <div className="rounded-[14px] border border-white/5 bg-[#20232b] p-4">
                          <p className="text-[13px] font-bold text-slate-200">{secondaryFeature?.title || 'Built-in Chat'}</p>
                          <p className="mt-[6px] text-[11px] font-medium leading-[1.5] text-[#868d9a]">{secondaryFeature?.description || 'Talk to local and cloud models from the same workspace.'}</p>
                        </div>
                        <div className="rounded-[14px] border border-white/5 bg-[#20232b] p-4">
                          <p className="text-[13px] font-bold text-slate-200">{tertiaryFeature?.title || 'Mod Host'}</p>
                          <p className="mt-[6px] text-[11px] font-medium leading-[1.5] text-[#868d9a]">{tertiaryFeature?.description || 'Launch installed mods without leaving the desktop app.'}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-[14px]">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9ca3af]">{chromeLabels.activity}</p>
                      <div className="flex flex-col rounded-[14px] border border-white/5 bg-[#20232b] py-2">
                        <div className="flex items-center justify-between px-4 py-2">
                          <span className="font-mono text-[11px] text-slate-300">local/qwen2.5</span>
                          <span className="text-[11px] font-semibold text-[#4ade80]">{chromeLabels.ready}</span>
                        </div>
                        <div className="flex items-center justify-between border-t border-white/5 px-4 py-2">
                          <span className="font-mono text-[11px] text-slate-300">gemini</span>
                          <span className="text-[11px] font-semibold text-[#38bdf8]">{chromeLabels.connected}</span>
                        </div>
                        <div className="flex items-center justify-between border-t border-white/5 px-4 py-2">
                          <span className="font-mono text-[11px] text-slate-300">mods/local-chat</span>
                          <span className="text-[11px] font-semibold text-[#9ca3af]">{chromeLabels.installed}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:mt-14 lg:grid-cols-4">
          {props.content.features.map((feature, idx) => (
            <article
              key={feature.title}
              className="reveal flex flex-col justify-start rounded-[24px] border border-slate-100 bg-[#f9fdfc]/90 p-7 shadow-[0_8px_30px_rgba(45,212,191,0.06)] backdrop-blur-md transition-all hover:-translate-y-1 hover:bg-white hover:shadow-[0_15px_40px_rgba(45,212,191,0.12)]"
            >
              <div className="mb-5 flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-slate-200/60 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                {featureIcons[idx] || feature.icon}
              </div>
              <h3 className="text-[16px] font-bold leading-tight text-slate-900">
                {feature.title}
              </h3>
              <p className="mt-2.5 text-[14px] font-medium leading-relaxed text-[#64748b]">
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

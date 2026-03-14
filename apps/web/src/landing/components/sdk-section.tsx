import { useState } from 'react';
import sdkPreview from '../../../../../docs/assets/nimi-sdk.gif';
import multimodalPreview from '../../../../../docs/assets/nimi-multimodal.gif';
import streamJobPreview from '../../../../../docs/assets/nimi-stream-job.gif';
import workflowPreview from '../../../../../docs/assets/nimi-workflow.gif';
import type { LandingContent } from '../content/landing-content.js';
import type { LandingLocale } from '../i18n/locale.js';

export type SdkSectionProps = {
  content: LandingContent['sdk'];
  locale: LandingLocale;
};

export function SdkSection(props: SdkSectionProps) {
  const [activeTab, setActiveTab] = useState(0);
  const isChinese = props.locale === 'zh';
  const previewMedia = [
    { src: sdkPreview, alt: props.content.previewAlt },
    { src: multimodalPreview, alt: props.content.multimodalAlt },
    { src: streamJobPreview, alt: 'Nimi stream job walkthrough' },
    { src: workflowPreview, alt: 'Nimi workflow walkthrough' },
  ];
  const activePreview = previewMedia[activeTab] ?? previewMedia[0]!;

  return (
    <section id="sdk" className="relative overflow-hidden bg-slate-50 section-pad font-sans">
      <div className="pointer-events-none absolute right-0 top-1/2 h-[600px] w-[600px] -translate-y-1/2 rounded-full bg-gradient-to-br from-blue-400/20 to-emerald-400/20 blur-3xl opacity-70" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-14 max-w-3xl">
          {isChinese ? (
            <h2 className="mb-4 text-4xl font-extrabold tracking-tight text-slate-900 md:text-5xl">
              {props.content.title}
            </h2>
          ) : (
            <h2 className="mb-4 text-4xl font-extrabold tracking-tight md:text-5xl">
              <span className="block text-slate-900">One SDK.</span>
              <span className="mt-2 block">
                <span className="bg-gradient-to-r from-emerald-500 to-blue-500 bg-clip-text text-transparent">
                  Multiple ways
                </span>{' '}
                <span className="text-slate-900">to run AI.</span>
              </span>
            </h2>
          )}
          <p className="text-lg font-medium text-slate-500">{props.content.subtitle}</p>
        </div>

        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12 lg:gap-16">
          <div className="flex flex-col space-y-2 lg:col-span-4">
            {props.content.tabs.map((tab, index) => {
              const isActive = activeTab === index;
              return (
                <button
                  key={tab.label}
                  onClick={() => setActiveTab(index)}
                  className={`group relative w-full rounded-2xl border p-6 text-left transition-all duration-300 ${
                    isActive
                      ? 'border-slate-200/60 bg-white shadow-sm'
                      : 'border-transparent bg-transparent opacity-70 hover:border-slate-200/60 hover:bg-white/50 hover:opacity-100'
                  }`}
                >
                  {isActive ? (
                    <div className="absolute left-0 top-1/2 h-12 w-1.5 -translate-y-1/2 rounded-r-full bg-emerald-400" />
                  ) : null}
                  <h3 className={`mb-2 text-xl font-bold ${isActive ? 'text-slate-900' : 'text-slate-700 group-hover:text-slate-900'}`}>
                    {tab.label}
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-500">{tab.caption}</p>
                </button>
              );
            })}
          </div>

          <div className="relative lg:col-span-8">
            <div className="absolute bottom-2 left-10 right-10 h-10 rounded-full bg-gradient-to-r from-emerald-500/14 to-blue-500/14 blur-lg opacity-35" />

            <div className="relative aspect-[16/10] overflow-hidden rounded-[1.5rem] border border-slate-700/50 bg-[#0B0F19] p-2 shadow-2xl sm:p-4">
              <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[1rem] bg-slate-950">
                <img
                  src={activePreview.src}
                  alt={activePreview.alt}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain object-center opacity-100 transition-opacity duration-500"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <a href="#install" className="inline-flex items-center text-sm font-semibold text-emerald-500 transition-colors hover:text-emerald-600">
                {props.content.callout}
                <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

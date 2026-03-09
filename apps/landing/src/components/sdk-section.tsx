import { useState } from 'react';
import type { LandingContent } from '../content/landing-content.js';
import { SectionHeader } from './section-header.js';

export type SdkSectionProps = {
  content: LandingContent['sdk'];
};

export function SdkSection(props: SdkSectionProps) {
  const [activeTab, setActiveTab] = useState<number>(0);
  const currentTab = props.content.tabs[activeTab];

  return (
    <section id="sdk" className="section-pad">
      <div className="container-nimi">
        <SectionHeader title={props.content.title} subtitle={props.content.subtitle} />

        <div className="reveal mt-10">
          <div className="flex gap-1 border-b border-white/10">
            {props.content.tabs.map((tab, index) => (
              <button
                key={tab.label}
                type="button"
                onClick={() => setActiveTab(index)}
                className={`px-4 py-2.5 text-sm font-semibold transition-colors ${
                  index === activeTab
                    ? 'border-b-2 border-mint-400 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {currentTab ? (
            <div className="card-surface mt-4">
              <pre className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950/75 p-4 text-xs leading-6 text-slate-100">
                <code>{currentTab.snippet}</code>
              </pre>
              <p className="mt-4 text-sm text-slate-300/90">{currentTab.caption}</p>
            </div>
          ) : null}

          <p className="mt-6 text-center text-base font-semibold text-mint-200">{props.content.callout}</p>
        </div>
      </div>
    </section>
  );
}

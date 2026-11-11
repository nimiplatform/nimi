import { Surface } from '@nimiplatform/kit/ui';
import { useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, KeyRound, Layers3, Search, Send, ShieldCheck } from 'lucide-react';
import type { StoryText, StoryKey } from '../../content/story-copy.js';
import { integrationScenarios } from '../../content/story-model.js';
import { StoryHeading, StoryLink } from './story-shared.js';
import type { LandingLinks } from '../../config/landing-links.js';

const integrationIcons = { mcp: Search, telegram: Send, app: Layers3 } as const;

export function StoryIntegrations({ t, links, onHome }: { t: StoryText; links: LandingLinks; onHome: () => void }) {
  const [scenario, setScenario] = useState<keyof typeof integrationScenarios>('mcp');
  const row = integrationScenarios[scenario];
  return <section id="integrations" className="story-section story-integrations" aria-labelledby="integrations-heading" data-story-scene>
    <div className="story-container">
      <div className="story-integration-layout">
        <div className="story-integration-intro">
          <StoryHeading t={t} section="integrations" />
          <div className="story-use-cases" role="group" aria-label={t('integrations.title')}>
            {(Object.keys(integrationScenarios) as (keyof typeof integrationScenarios)[]).map(key => {
              const Icon = integrationIcons[key];
              return <button className="story-use-case" key={key} type="button" aria-pressed={scenario === key} onClick={() => setScenario(key)}>
                <span className="story-use-case-icon"><Icon size={21} strokeWidth={1.8} /></span>
                <span><strong>{t(`integrations.${key}`)}</strong><small>{t(`integrations.${key}Detail`)}</small></span>
                <ChevronRight size={18} />
              </button>;
            })}
          </div>
        </div>
        <div className="story-integration-preview" data-scenario={scenario}>
          <Surface material="glass-thin" padding="none" className="story-integration-card">
            <header className="story-integration-card-header">
              <div className="story-integration-pair" aria-hidden="true"><img src={row.consumer === 'NimiGo' ? '/story/nimigo-icon.png' : '/story/nimiday-icon.png'} alt="" /><img src={row.icon} alt="" /></div>
              <span>{t('integrations.previewLabel')}</span>
              <small><i />{t('integrations.previewStatus')}</small>
            </header>
            <div className="story-integration-example" key={scenario}>
              <span>{t(`integrations.${scenario}`)}</span>
              <h3>{t(`integrations.${scenario}Action`)}</h3>
              <p>{t(`integrations.${scenario}Scope`)}</p>
            </div>
            <div className="story-integration-result">
              <span><Check size={19} /></span>
              <div><small>{t('integrations.result')}</small><p aria-live="polite">{t(`integrations.${scenario}Result` as StoryKey)}</p></div>
            </div>
            <footer><ShieldCheck size={14} />{t('integrations.demoNote')}</footer>
          </Surface>
        </div>
      </div>
      <div className="story-integration-controls">
        <article><ShieldCheck size={23} /><div><h3>{t('integrations.permissions')}</h3><p>{t('integrations.permissionDetail')}</p></div></article>
        <article><KeyRound size={23} /><div><h3>{t('security.credentials')}</h3><p>{t('security.credentialDetail')}</p></div></article>
      </div>
      <div className="story-integration-management">
        <p>{t('integrations.footnote')}</p>
        <div className="story-integration-actions"><button type="button" className="story-link" onClick={onHome}>{t('integrations.openHome')}<ArrowUpRight size={16} /></button><StoryLink href={links.integrationsUrl}>{t('integrations.details')}</StoryLink></div>
      </div>
    </div>
  </section>;
}

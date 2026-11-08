import { Surface } from '@nimiplatform/kit/ui';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, Cloud, FileText, Image, KeyRound, Laptop, Layers3, Mic, Search, Send, ShieldCheck } from 'lucide-react';
import type { StoryText, StoryKey } from '../../content/story-copy.js';
import { integrationScenarios } from '../../content/story-model.js';
import { StoryHeading, StoryLink } from './story-shared.js';
import type { LandingLinks } from '../../config/landing-links.js';

const localModelMarks = [
  { provider: 'dashscope', label: 'Qwen' },
  { provider: 'google_veo', label: 'Gemma' },
  { provider: 'openai', label: 'Whisper' },
  { provider: 'deepseek', label: 'DeepSeek' },
  { provider: 'mistral', label: 'Mistral' },
  { provider: 'glm', label: 'GLM' },
] as const;

const cloudModelMarks = [
  { provider: 'openai_chatgpt_plan', label: 'ChatGPT' },
  { provider: 'kimi', label: 'Kimi' },
  { provider: 'anthropic', label: 'Claude' },
  { provider: 'gemini', label: 'Gemini' },
  { provider: 'deepseek', label: 'DeepSeek' },
  { provider: 'dashscope', label: 'Qwen' },
  { provider: 'xai', label: 'Grok' },
  { provider: 'mistral', label: 'Mistral' },
  { provider: 'minimax', label: 'MiniMax' },
  { provider: 'glm', label: 'GLM' },
] as const;

function StoryModelMarks({ route }: { route: 'local' | 'cloud' }) {
  const marks = route === 'local' ? localModelMarks : cloudModelMarks;
  return <div className={`story-model-marks story-model-marks--${route}`} aria-hidden="true">
    {marks.map(mark => <span className="story-model-mark" key={mark.provider}>
      <Surface as="svg" material="glass-thin" padding="none" viewBox="0 0 24 24" focusable="false"><use href={`/demo/cloud-provider-marks.svg#${mark.provider}`} /></Surface>
      <small>{mark.label}</small>
    </span>)}
  </div>;
}

export function StoryPower({ t, links, onHome }: { t: StoryText; links: LandingLinks; onHome: (surface: 'runtime' | 'cloud', target?: string) => void }) {
  const [task, setTask] = useState<'text' | 'image' | 'speech'>('text');
  const [route, setRoute] = useState<'local' | 'cloud'>('local');
  const [automaticRoute, setAutomaticRoute] = useState(true);
  useEffect(() => {
    if (!automaticRoute) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: number | undefined;
    const update = () => {
      window.clearInterval(timer);
      if (!media.matches) timer = window.setInterval(() => setRoute(current => current === 'local' ? 'cloud' : 'local'), 3000);
    };
    update();
    media.addEventListener('change', update);
    return () => { window.clearInterval(timer); media.removeEventListener('change', update); };
  }, [automaticRoute]);
  const selectRoute = (nextRoute: 'local' | 'cloud') => {
    setAutomaticRoute(false);
    setRoute(nextRoute);
  };
  const Icon = task === 'text' ? FileText : task === 'image' ? Image : Mic;
  const capability = { text: 'text.generate', image: 'image.generate', speech: 'audio.transcribe' }[task];
  return <section id="models" className="story-section story-power" aria-labelledby="power-heading" data-story-scene onFocusCapture={() => setAutomaticRoute(false)} onPointerDown={() => setAutomaticRoute(false)}>
    <div className="story-container">
      <div className="story-power-intro"><StoryHeading t={t} section="power"><StoryLink href={links.modelsUrl}>{t('power.catalog')}</StoryLink></StoryHeading><div className="story-task-picker" role="group" aria-label={t('power.request')}>{(['text', 'image', 'speech'] as const).map(type => <button key={type} type="button" aria-pressed={task === type} onClick={() => setTask(type)}>{t(`power.${type}`)}</button>)}</div></div>
      <div className="story-power-scene" data-route={route}>
        <div className="story-power-artwork" aria-hidden="true">
          <img className="story-power-landscape" src="/story/power-scene-v3.webp" alt="" loading="lazy" />
          <StoryModelMarks route="local" />
          <StoryModelMarks route="cloud" />
        </div>
        <article className="story-task-paper" key={task}><Icon size={28} /><h3>{t(`power.${task}Task` as StoryKey)}</h3></article>
        <div className="story-route-picker" role="group" aria-label={t('power.title')}>
          <button className="story-local-destination" type="button" aria-pressed={route === 'local'} onClick={() => selectRoute('local')}><Laptop size={24} strokeWidth={1.6} /><Surface as="span" material="glass-thin" padding="none"><small>{t('power.local')}</small><strong>{t('power.localTarget')}</strong></Surface>{route === 'local' && <Check size={18} />}</button>
          <button className="story-cloud-destination" type="button" aria-pressed={route === 'cloud'} onClick={() => selectRoute('cloud')}><Cloud size={24} strokeWidth={1.6} /><Surface as="span" material="glass-thin" padding="none"><small>{t('power.cloud')}</small><strong>{t('power.cloudTarget')}</strong></Surface>{route === 'cloud' && <Check size={18} />}</button>
        </div>
        <div className="story-route-trace" aria-hidden="true" key={`${task}-${route}`}><svg viewBox="0 0 260 76" preserveAspectRatio="none" focusable="false"><path className="story-route-trace-line" d="M4 0v18c0 26 14 40 40 40h204" /><path className="story-route-trace-head" d="m236 46 14 12-14 12" /><path className="story-route-trace-pulse" pathLength="100" d="M4 0v18c0 26 14 40 40 40h204" /></svg></div>
        <div className="story-route-outcome" aria-live={automaticRoute ? 'off' : 'polite'}><p>{t(route === 'local' ? 'power.localDetail' : 'power.cloudDetail')}</p><button type="button" className="story-link" onClick={() => onHome(route === 'local' ? 'runtime' : 'cloud', route === 'local' ? capability : undefined)}>{t('common.openHome')}<ArrowUpRight size={15} /></button></div>
      </div>
    </div>
  </section>;
}

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

import { Surface } from '@nimiplatform/kit/ui';
import { useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Cloud, FileText, Image, Laptop, Mic, RotateCcw, ShieldCheck } from 'lucide-react';
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
  const Icon = task === 'text' ? FileText : task === 'image' ? Image : Mic;
  const capability = { text: 'text.generate', image: 'image.generate', speech: 'audio.transcribe' }[task];
  return <section id="models" className="story-section story-power" aria-labelledby="power-heading" data-story-scene>
    <div className="story-container">
      <div className="story-power-intro"><StoryHeading t={t} section="power"><StoryLink href={links.modelsUrl}>{t('power.catalog')}</StoryLink></StoryHeading><div className="story-task-picker" role="group" aria-label={t('power.request')}>{(['text', 'image', 'speech'] as const).map(type => <button key={type} type="button" aria-pressed={task === type} onClick={() => setTask(type)}>{t(`power.${type}`)}</button>)}</div></div>
      <div className="story-power-scene" data-route={route}>
        <img className="story-power-landscape" src="/story/power-scene-v3.webp" alt="" loading="lazy" />
        <StoryModelMarks route="local" />
        <StoryModelMarks route="cloud" />
        <article className="story-task-paper" key={task}><Icon size={28} /><small>{t('power.request')}</small><h3>{t(`power.${task}Task` as StoryKey)}</h3></article>
        <div className="story-route-picker" role="group" aria-label={t('power.title')}>
          <button className="story-local-destination" type="button" aria-pressed={route === 'local'} onClick={() => setRoute('local')}><Laptop size={64} strokeWidth={1.2} /><Surface as="span" material="glass-thin" padding="none"><small>{t('power.local')}</small><strong>{t('power.localTarget')}</strong></Surface>{route === 'local' && <Check size={18} />}</button>
          <button className="story-cloud-destination" type="button" aria-pressed={route === 'cloud'} onClick={() => setRoute('cloud')}><Cloud size={76} strokeWidth={1.1} /><Surface as="span" material="glass-thin" padding="none"><small>{t('power.cloud')}</small><strong>{t('power.cloudTarget')}</strong></Surface>{route === 'cloud' && <Check size={18} />}</button>
        </div>
        <div className="story-route-trace" aria-hidden="true" key={`${task}-${route}`}><ArrowDown size={20} /></div>
        <div className="story-route-outcome" aria-live="polite"><p>{t(route === 'local' ? 'power.localDetail' : 'power.cloudDetail')}</p><button type="button" className="story-link" onClick={() => onHome(route === 'local' ? 'runtime' : 'cloud', route === 'local' ? capability : undefined)}>{t('common.openHome')}<ArrowUpRight size={15} /></button></div>
      </div>
      <div className="story-power-notes"><p>{t('power.note')}</p><p>{t('power.cost')}</p></div>
    </div>
  </section>;
}

export function StoryIntegrations({ t, onHome }: { t: StoryText; onHome: () => void }) {
  const [scenario, setScenario] = useState<keyof typeof integrationScenarios>('mcp');
  const [ran, setRan] = useState(false);
  const row = integrationScenarios[scenario];
  return <section id="integrations" className="story-section story-integrations" aria-labelledby="integrations-heading" data-story-scene>
    <div className="story-container">
      <div className="story-integration-intro"><StoryHeading t={t} section="integrations" /><button type="button" className="story-link" onClick={onHome}>{t('common.openHome')}<ArrowUpRight size={16} /></button></div>
      <div className="story-connection-tabs" role="group" aria-label={t('common.integrations')}>{(Object.keys(integrationScenarios) as (keyof typeof integrationScenarios)[]).map(key => <button key={key} type="button" aria-pressed={scenario === key} onClick={() => { setScenario(key); setRan(false); }}>{t(`integrations.${key}`)}</button>)}</div>
      <div className="story-connection-stage" data-state={ran ? 'complete' : 'waiting'} key={scenario}>
        <div className="story-connection-endpoint is-source"><img src={row.icon} alt="" /><small>{t('integrations.connection')}</small><strong>{row.service}</strong></div>
        <div className="story-connection-wire is-first" aria-hidden="true"><ArrowRight size={22} /></div>
        <div className="story-connection-scope"><ShieldCheck size={21} /><small>{t('integrations.permission')}</small><p>{t(`integrations.${scenario}Scope` as StoryKey)}</p><button type="button" className="story-button" onClick={() => setRan(!ran)}>{ran ? <RotateCcw size={16} /> : <ArrowRight size={16} />}{t(ran ? 'integrations.reset' : 'integrations.run')}</button></div>
        <div className="story-connection-wire is-second" aria-hidden="true"><ArrowRight size={22} /></div>
        <div className="story-connection-endpoint is-consumer"><img src={row.consumer === 'NimiGo' ? '/story/nimigo-icon.png' : '/story/nimiday-icon.png'} alt="" /><small>{t('integrations.consumer')}</small><strong>{row.consumer}</strong></div>
        <div className="story-connection-result" aria-live="polite" data-state={ran ? 'complete' : 'waiting'}><span>{ran ? <Check size={18} /> : <ArrowRight size={18} />}{t('integrations.result')}</span><p>{ran ? t(`integrations.${scenario}Result` as StoryKey) : t('integrations.waiting')}</p></div>
      </div>
      <div className="story-integration-notes"><div><p>{t('integrations.permissions')}</p></div><details><summary>{t('common.details')}</summary><p>{t('integrations.note')}</p><p>{t('integrations.unconfirmed')}</p></details></div>
    </div>
  </section>;
}

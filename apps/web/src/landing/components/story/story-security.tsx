import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, KeyRound, ScanLine, Send, ShieldCheck, StopCircle } from 'lucide-react';
import { reduceContentCheckDemo, type ContentCheckDemo } from '../../content/content-check-demo.js';
import type { StoryText } from '../../content/story-copy.js';
import { StoryHeading, StoryLink } from './story-shared.js';
import type { LandingLinks } from '../../config/landing-links.js';

export function StorySecurity({ t, links }: { t: StoryText; links: LandingLinks }) {
  const [scenario, setScenario] = useState<'normal' | 'blocked'>('normal');
  const [state, setState] = useState<ContentCheckDemo>({ draft: t('security.request'), phase: 'draft' });
  const input = useRef<HTMLTextAreaElement>(null);
  const changeScenario = (next: 'normal' | 'blocked') => {
    setScenario(next); setState({ draft: [t('security.request'), next === 'blocked' ? t('security.sampleMarker') : ''].filter(Boolean).join('\n'), phase: 'draft' });
  };
  useEffect(() => { if (state.phase === 'editing') input.current?.focus({ preventScroll: true }); }, [state.phase]);
  return <section id="risk-control" className="story-section story-security" aria-labelledby="security-heading" data-story-scene><div className="story-container">
    <div className="story-security-intro"><StoryHeading t={t} section="security" /><div className="story-security-switch" role="group" aria-label={t('security.check')}><button type="button" aria-pressed={scenario === 'normal'} onClick={() => changeScenario('normal')}>{t('security.normal')}</button><button type="button" aria-pressed={scenario === 'blocked'} onClick={() => changeScenario('blocked')}>{t('security.blocked')}</button></div></div>
    <div className="story-security-workbench" data-phase={state.phase}>
      <div className="story-security-request"><header><img src="/logo.svg" alt="" /><strong>Nimi Chat</strong></header><form onSubmit={e => { e.preventDefault(); setState(previous => reduceContentCheckDemo(previous, { type: 'submit', marker: t('security.sampleMarker') })); }}>
        <label className="sr-only" htmlFor="security-draft">Nimi Chat</label><textarea id="security-draft" ref={input} rows={4} value={state.draft} disabled={state.phase === 'blocked'} onChange={e => setState(previous => reduceContentCheckDemo(previous, { type: 'change', text: e.target.value }))} />
        <button className="story-button" type="submit" disabled={state.phase === 'blocked' || !state.draft.trim()}><Send size={16} />{t('security.try')}</button>
      </form>{state.phase === 'editing' && state.draft.includes(t('security.sampleMarker')) && <div className="story-security-edit"><button type="button" onClick={() => setState(previous => reduceContentCheckDemo(previous, { type: 'remove-example', marker: t('security.sampleMarker') }))}>{t('security.remove')}</button></div>}</div>
      <div className="story-security-connection" aria-hidden="true"><ArrowRight size={22} /></div>
      <div className="story-security-boundaries"><article><ShieldCheck size={30} strokeWidth={1.4} /><h3>{t('security.appAccess')}</h3><p>{t('security.accessDetail')}</p></article><article><KeyRound size={30} strokeWidth={1.4} /><h3>{t('security.credentials')}</h3><p>{t('security.credentialDetail')}</p></article></div>
      <div className="story-security-connection" aria-hidden="true"><ArrowRight size={22} /></div>
      <div className="story-security-result" aria-live="polite" key={state.phase}>{state.phase === 'blocked' ? <StopCircle size={42} strokeWidth={1.3} /> : state.phase === 'submitted' ? <Check size={42} strokeWidth={1.3} /> : <ScanLine size={42} strokeWidth={1.3} />}<h3>{t(state.phase === 'blocked' ? 'security.stopped' : state.phase === 'submitted' ? 'security.allowed' : 'security.check')}</h3><p>{t(state.phase === 'blocked' ? 'security.refused' : state.phase === 'submitted' ? 'security.sent' : state.phase === 'editing' ? 'security.editNote' : 'security.ready')}</p>{state.phase === 'blocked' && <button type="button" className="story-link" onClick={() => setState(previous => reduceContentCheckDemo(previous, { type: 'edit' }))}>{t('security.edit')}<ArrowRight size={16} /></button>}</div>
    </div>
    <div className="story-security-footnotes"><p className="story-security-scope">{t('security.scope')}</p><p className="story-security-note">{t('security.note')}</p><p className="story-security-note">{t('security.limit')}</p><details className="story-security-limits"><summary>{t('common.details')}</summary><p>{t('security.checkDetail')}</p><p>{t('security.noSandbox')}</p><StoryLink href={links.riskControlUrl}>{t('common.docs')}</StoryLink></details></div>
  </div></section>;
}

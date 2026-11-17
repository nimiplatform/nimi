import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ScanLine, Send, StopCircle } from 'lucide-react';
import { reduceContentCheckDemo, type ContentCheckDemo } from '../../content/content-check-demo.js';
import type { StoryText } from '../../content/story-copy.js';
import { StoryLink } from './story-shared.js';
import type { LandingLinks } from '../../config/landing-links.js';

export function StoryContentCheck({ t, links }: { t: StoryText; links: LandingLinks }) {
  const [scenario, setScenario] = useState<'normal' | 'blocked'>('normal');
  const [state, setState] = useState<ContentCheckDemo>({ draft: t('security.request'), phase: 'draft' });
  const input = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const marker = t('security.sampleMarker');
  const isBlocked = state.phase === 'blocked';
  const isSubmitted = state.phase === 'submitted';
  const ResultIcon = isBlocked ? StopCircle : isSubmitted ? Check : ScanLine;

  const changeScenario = (next: 'normal' | 'blocked') => {
    setScenario(next);
    setState({
      draft: next === 'blocked' ? `${t('security.request')}\n${marker}` : t('security.request'),
      phase: 'draft',
    });
  };

  useEffect(() => {
    if (state.phase === 'blocked') editButton.current?.focus();
    if (state.phase === 'editing' || state.phase === 'submitted') input.current?.focus({ preventScroll: true });
  }, [state.phase]);

  return (
    <details className="story-content-check">
      <summary>
        <ScanLine size={21} aria-hidden="true" />
        <span>{t('security.check')}</span>
        <ChevronDown size={18} className="story-content-check-chevron" aria-hidden="true" />
      </summary>
      <div className="story-content-check-body">
        <p className="story-security-demo-note" id="content-check-demo-note">{t('security.demoNote')}</p>
        <div className="story-security-switch" role="group" aria-label={t('security.examples')}>
          <button type="button" aria-pressed={scenario === 'normal'} onClick={() => changeScenario('normal')}>{t('security.normal')}</button>
          <button type="button" aria-pressed={scenario === 'blocked'} onClick={() => changeScenario('blocked')}>{t('security.blocked')}</button>
        </div>
        <div className="story-security-workbench" data-phase={state.phase}>
          <div className="story-security-request">
            <form onSubmit={event => {
              event.preventDefault();
              setState(previous => reduceContentCheckDemo(previous, { type: 'submit', marker }));
            }}>
              <label htmlFor="security-draft">{t('security.requestLabel')}</label>
              <textarea
                id="security-draft"
                ref={input}
                rows={4}
                value={state.draft}
                disabled={isBlocked}
                aria-describedby="content-check-demo-note"
                onChange={event => setState(previous => reduceContentCheckDemo(previous, { type: 'change', text: event.target.value }))}
              />
              <button className="story-button" type="submit" disabled={isBlocked || !state.draft.trim()}>
                <Send size={16} aria-hidden="true" />
                {t('security.try')}
              </button>
            </form>
            {state.phase === 'editing' && state.draft.includes(marker) && (
              <div className="story-security-edit">
                <button type="button" onClick={() => {
                  setState(previous => reduceContentCheckDemo(previous, { type: 'remove-example', marker }));
                  input.current?.focus();
                }}>{t('security.remove')}</button>
              </div>
            )}
          </div>
          <div className="story-security-connection" aria-hidden="true"><ArrowRight size={22} /></div>
          <div className="story-security-result">
            <ResultIcon size={32} strokeWidth={1.3} aria-hidden="true" />
            <p role="status">{t(isBlocked ? 'security.stopped' : isSubmitted ? 'security.allowed' : 'security.result')}</p>
            {isBlocked && (
              <button ref={editButton} type="button" className="story-link" onClick={() => setState(previous => reduceContentCheckDemo(previous, { type: 'edit' }))}>
                {t('security.edit')}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="story-security-intro">
          <p>{t('security.checkDetail')}</p>
          <StoryLink href={links.riskControlUrl}>{t('security.docs')}</StoryLink>
        </div>
      </div>
    </details>
  );
}

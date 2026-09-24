import { useState } from 'react';
import { Button, Surface, TextField, Toggle } from '@nimiplatform/kit/ui';
import { BellRing, CalendarHeart, HeartHandshake, Sparkles } from 'lucide-react';
import { CIRCLE_TEMPLATES } from '../domain/defaults.js';
import type { CircleKind } from '../domain/types.js';
import { describeSchedule } from '../i18n/index.js';
import { useDayStore, useDesk, useNimiDay } from '../app/context.js';
import { requestSystemPermission, systemPermission, type SystemPermission } from '../platform/notifier.js';
import { AppointPanel } from './appoint-panel.js';
import { CIRCLE_ICONS } from './common.js';
import { onboardingSteps, type CircleDraft } from './onboarding-steps.js';


export function Onboarding() {
  const { copy, actions } = useNimiDay();
  const { state } = useDayStore();
  const desk = useDesk();
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<CircleDraft[]>([]);
  const steps = onboardingSteps(actions);
  const [permission, setPermission] = useState<SystemPermission>(systemPermission);
  const total = 4;

  const addDraft = (kind: CircleKind) => {
    const name = kind === 'self' || kind === 'home' || kind === 'money' ? copy.kinds.circle[kind] : '';
    setDrafts((current) => [...current, { key: `${kind}-${Date.now()}-${current.length}`, kind, name }]);
  };

  const saveCircles = () => setStep(steps.continueFromCircles(drafts));

  const finish = () => steps.finish(drafts);

  return (
    <div className="nd-onboarding" data-testid="nd-onboarding">
      <Surface tone="card" elevation="floating" padding="lg" className="nd-onboarding-card">
        <div className="nd-split" style={{ marginBottom: 14 }}>
          <div className="nd-brand" style={{ padding: 0 }}>
            <span className="nd-brand-mark"><CalendarHeart size={16} aria-hidden="true" /></span>
            <span className="nd-brand-name">{copy.app.name}</span>
          </div>
          <span className="nd-faint">{copy.onboarding.step(step + 1, total)}</span>
        </div>

        {step === 0 ? (
          <>
            <h1 className="nd-page-title">{copy.onboarding.welcomeTitle}</h1>
            <p className="nd-muted" style={{ lineHeight: 1.7 }}>{copy.onboarding.welcomeBody}</p>
            <ul className="nd-onboarding-points">
              {copy.onboarding.points.map((point, index) => {
                const Icon = [CalendarHeart, BellRing, HeartHandshake][index] ?? Sparkles;
                return (
                  <li key={point}>
                    <Icon size={18} aria-hidden="true" style={{ flex: 'none', marginTop: 2, color: 'var(--nimi-action-primary-bg)' }} />
                    {point}
                  </li>
                );
              })}
            </ul>
            <Button tone="primary" size="md" onClick={() => setStep(1)}>{copy.onboarding.start}</Button>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h1 className="nd-page-title">{copy.onboarding.chooseTitle}</h1>
            <div style={{ marginTop: 12 }}>
              <AppointPanel onDone={() => setStep(2)} />
            </div>
            <div className="nd-split" style={{ marginTop: 18 }}>
              <Button tone="ghost" size="sm" onClick={() => setStep(0)}>{copy.common.back}</Button>
              <Button tone="ghost" size="sm" onClick={() => setStep(2)}>{desk.phase === 'ready' ? copy.common.next : copy.onboarding.skipAgent}</Button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h1 className="nd-page-title">{copy.onboarding.circlesTitle}</h1>
            <p className="nd-muted">{copy.onboarding.circlesBody}</p>
            <div className="nd-kind-picker" style={{ margin: '14px 0' }}>
              {CIRCLE_TEMPLATES.map((template) => {
                const Icon = CIRCLE_ICONS[template.kind];
                return (
                  <button key={template.kind} type="button" className="nd-kind-option" onClick={() => addDraft(template.kind)} data-testid={`nd-kind-${template.kind}`}>
                    <Icon size={14} aria-hidden="true" />
                    {copy.kinds.circle[template.kind]}
                  </button>
                );
              })}
            </div>
            <div className="nd-form">
              {drafts.map((draft, index) => {
                const Icon = CIRCLE_ICONS[draft.kind];
                return (
                  <div key={draft.key} className="nd-inline-actions" style={{ flexWrap: 'nowrap' }}>
                    <Icon size={16} aria-hidden="true" style={{ flex: 'none' }} />
                    <TextField
                      value={draft.name}
                      autoFocus={draft.name === ''}
                      placeholder={copy.kinds.circlePlaceholder[draft.kind]}
                      aria-label={copy.onboarding.circleNamePlaceholder}
                      maxLength={60}
                      onChange={(event) => setDrafts((current) => current.map((entry, position) => (position === index ? { ...entry, name: event.target.value } : entry)))}
                    />
                    <Button tone="ghost" size="sm" onClick={() => setDrafts((current) => current.filter((_, position) => position !== index))}>{copy.common.delete}</Button>
                  </div>
                );
              })}
            </div>
            <div className="nd-split" style={{ marginTop: 18 }}>
              <Button tone="ghost" size="sm" onClick={() => setStep(1)}>{copy.common.back}</Button>
              <Button tone="primary" size="sm" onClick={saveCircles} disabled={drafts.length > 0 && drafts.every((draft) => !draft.name.trim())}>
                {drafts.length === 0 ? copy.common.later : copy.common.next}
              </Button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h1 className="nd-page-title">{copy.onboarding.rhythmTitle}</h1>
            <p className="nd-muted">{copy.onboarding.rhythmBody}</p>
            <div style={{ margin: '12px 0' }}>
              {state.rhythms.map((rhythm) => (
                <div key={rhythm.id} className="nd-setting">
                  <div className="nd-setting-text">
                    <span className="nd-setting-title">{rhythm.name}</span>
                    <span className="nd-setting-hint">{describeSchedule(copy, rhythm.schedule)}</span>
                  </div>
                  <Toggle checked={rhythm.enabled} ariaLabel={rhythm.name} onValueChange={(value) => actions.setRhythmEnabled(rhythm.id, value)} />
                </div>
              ))}
              <div className="nd-setting">
                <div className="nd-setting-text">
                  <span className="nd-setting-title">{copy.onboarding.notifyTitle}</span>
                  <span className="nd-setting-hint">{copy.onboarding.notifyBody}</span>
                </div>
                {permission === 'granted' ? (
                  <span className="nd-faint">{copy.onboarding.notifyAllowed}</span>
                ) : permission === 'denied' ? (
                  <span className="nd-faint">{copy.onboarding.notifyDenied}</span>
                ) : permission === 'unsupported' ? null : (
                  <Button tone="secondary" size="sm" onClick={() => { void requestSystemPermission().then(setPermission); }}>{copy.onboarding.notifyAllow}</Button>
                )}
              </div>
              <p className="nd-faint">{copy.onboarding.quietBody(state.profile.quiet.start, state.profile.quiet.end)}</p>
            </div>
            <div className="nd-split">
              <Button tone="ghost" size="sm" onClick={() => setStep(2)}>{copy.common.back}</Button>
              <Button tone="primary" size="md" onClick={finish} data-testid="nd-onboarding-finish">{copy.onboarding.finish}</Button>
            </div>
          </>
        ) : null}
      </Surface>
    </div>
  );
}

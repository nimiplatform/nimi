import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, InlineAlert, Toggle } from '@nimiplatform/kit/ui';
import { translateAgentCenter } from '../i18n.js';
import { getAgentCenterMessage } from '../locales/index.js';
import type { AgentCenterAutonomyMutationInput, AgentCenterAutonomyState, AgentCenterI18n, AgentCenterPlacementActions, AgentCenterSession, AgentCenterSnapshot } from '../types.js';
import { Card, SectionHeader, SectionShell, agentCenterInputClassName, cnAgentCenter } from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';
import { AgentCenterLifePanel } from './AgentCenterLifePanel.js';

export interface AgentCenterBehaviorSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
  readonly placementActions?: AgentCenterPlacementActions;
  readonly onNavigationStateChange?: (state: { readonly dirty: boolean; readonly saving: boolean }) => void;
}

type ValidationError = 'contactLimit' | 'daily' | 'output' | 'quietHoursMissing' | 'quietHours' | 'timezone' | null;

function deviceTimezone(): string { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } }
function clock(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }
function minutes(value: string): number { const [hour, minute] = value.split(':').map(Number); return hour! * 60 + minute!; }
function nonNegativeInteger(value: string): boolean { return /^\d+$/u.test(value) && Number.isSafeInteger(Number(value)); }
function draftOf(value: AgentCenterAutonomyState) {
  return { enabled: value.enabled === true, mode: (value.mode && value.mode !== 'off' ? value.mode : 'low') as AgentCenterAutonomyMutationInput['mode'],
    daily: value.dailyTokenBudget === null ? '' : String(value.dailyTokenBudget), output: value.maxBackgroundOutputTokens === null ? '' : String(value.maxBackgroundOutputTokens),
    freeContact: value.freeContactEnabled === true, limit: String(value.maxFreeContactsPerDay ?? 3), quiet: value.quietHours !== null,
    timezone: value.quietHours?.timezone ?? deviceTimezone(), start: clock(value.quietHours?.startMinute ?? 1320), end: clock(value.quietHours?.endMinute ?? 480) };
}

export function AgentCenterBehaviorSection({ session, snapshot, i18n, placementActions, onNavigationStateChange }: AgentCenterBehaviorSectionProps) {
  const autonomy = snapshot.state.autonomy;
  const [draft, setDraft] = useState(() => draftOf(autonomy));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'failed' | null>(null);
  const [validationError, setValidationError] = useState<ValidationError>(null);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const edited = useRef(false);
  const base = useRef({ session, revision: autonomy.revision });
  const current = useRef<AgentCenterSession | null>(session);
  const budgetDetails = useRef<HTMLDetailsElement | null>(null);
  current.current = session;
  useEffect(() => { current.current = session; return () => { current.current = null; }; }, [session]);
  useEffect(() => {
    if (base.current.session === session && base.current.revision === autonomy.revision) return;
    if (base.current.session === session && edited.current) { setRemoteChanged(true); return; }
    base.current = { session, revision: autonomy.revision };
    edited.current = false;
    setDraft(draftOf(autonomy)); setRemoteChanged(false); setNotice(null); setValidationError(null);
  }, [session, autonomy.revision]);
  const text = (key: string) => { const id = `AgentCenter.lifeSettings.${key}`; return translateAgentCenter(i18n, id, getAgentCenterMessage('en', id) ?? ''); };
  const available = snapshot.availability.updateAutonomy.state === 'available' && !autonomy.controlsDisabled;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(autonomy));
  useLayoutEffect(() => {
    onNavigationStateChange?.({ dirty: dirty || remoteChanged, saving });
  }, [dirty, onNavigationStateChange, remoteChanged, saving]);
  useLayoutEffect(() => () => {
    onNavigationStateChange?.({ dirty: false, saving: false });
  }, [onNavigationStateChange]);
  const change = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => {
    edited.current = true; setNotice(null); setValidationError(null);
    setDraft(old => ({ ...old, [key]: value }));
  };
  const reset = () => {
    edited.current = false; base.current = { session, revision: autonomy.revision };
    setDraft(draftOf(autonomy)); setRemoteChanged(false); setNotice(null); setValidationError(null);
  };
  const validate = (): ValidationError => {
    const limit = Number(draft.limit);
    if (!nonNegativeInteger(draft.limit) || limit > 24 || (draft.freeContact && limit < 1)) return 'contactLimit';
    if (draft.quiet && (!draft.start || !draft.end)) return 'quietHoursMissing';
    if (draft.quiet && draft.start === draft.end) return 'quietHours';
    if (draft.quiet && !draft.timezone.trim()) return 'timezone';
    if (!nonNegativeInteger(draft.daily)) return 'daily';
    if (!nonNegativeInteger(draft.output) || Number(draft.output) > 2147483647) return 'output';
    return null;
  };
  const save = async () => {
    if (!available || !base.current.revision || saving || remoteChanged) return;
    const invalid = validate();
    if (invalid) {
      setNotice(null); setValidationError(invalid);
      if (invalid === 'daily' || invalid === 'output') {
        if (budgetDetails.current) budgetDetails.current.open = true;
      }
      return;
    }
    setSaving(true); setNotice(null); setValidationError(null);
    try {
      await session.updateAutonomy({ expectedRevision: base.current.revision, enabled: draft.enabled, mode: draft.mode,
        dailyTokenBudget: Number(draft.daily), maxBackgroundOutputTokens: Number(draft.output), freeContactEnabled: draft.freeContact,
        maxFreeContactsPerDay: Number(draft.limit), quietHours: draft.quiet ? { timezone: draft.timezone.trim(), startMinute: minutes(draft.start), endMinute: minutes(draft.end) } : null });
      if (current.current === session) {
        const saved = session.getSnapshot().state.autonomy;
        edited.current = false; base.current = { session, revision: saved.revision };
        setRemoteChanged(false); setDraft(draftOf(saved)); setNotice('saved');
      }
    } catch { if (current.current === session) setNotice('failed'); } finally { if (current.current === session) setSaving(false); }
  };
  const labelClass = 'grid min-w-0 gap-1.5 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-primary)]';
  const helpClass = 'm-0 text-[length:var(--nimi-type-caption-size)] leading-[1.55] text-[var(--nimi-text-secondary)]';
  const fieldRowClass = 'flex flex-wrap items-center justify-between gap-3';
  const settingHeader = (input: {
    readonly title: string;
    readonly description: string;
    readonly enabled: boolean;
    readonly draftEnabled: boolean;
    readonly onChange: (value: boolean) => void;
    readonly pendingLabel: string;
  }) => <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <h3 className="m-0 text-[length:var(--nimi-type-body-size)] font-semibold text-[var(--nimi-text-primary)]">{input.title}</h3>
      <p className={`${helpClass} mt-1.5`}>{input.description}</p>
      {input.enabled !== input.draftEnabled ? <p className="m-0 mt-2 text-[length:var(--nimi-type-caption-size)] font-medium text-[var(--nimi-action-primary-bg)]">{input.pendingLabel}</p> : null}
    </div>
    <Toggle checked={input.draftEnabled} ariaLabel={input.title} disabled={!available || saving} onChange={input.onChange} />
  </div>;
  const errorId = 'agent-center-behavior-validation';
  const fieldError = (key: Exclude<ValidationError, null>) => validationError === key ? errorId : undefined;
  const quietHoursInvalid = validationError === 'quietHours' || validationError === 'quietHoursMissing';
  const showSaveBar = dirty || remoteChanged || notice !== null || validationError !== null;
  const used = autonomy.usedTokensInWindow?.toLocaleString() ?? '—';
  const allowance = autonomy.dailyTokenBudget === 0 ? text('unlimited') : autonomy.dailyTokenBudget?.toLocaleString() ?? '—';
  return <SectionShell labelledBy="agent-center-behavior-title">
    <SectionHeader id="agent-center-behavior-title" title={text('title')} />
    <AgentCenterProductActionNotice action="updateAutonomy" availability={snapshot.availability.updateAutonomy} session={session} i18n={i18n} onOpenRuntimeSettings={placementActions?.openRuntimeSettings} />
    <form className="grid min-w-0 gap-3" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={!available || saving} className="m-0 grid min-w-0 gap-3 border-0 p-0">
        <Card className="grid gap-3 p-4">
          {settingHeader({
            title: text('freeContact'), description: text('freeHelp'), enabled: autonomy.freeContactEnabled === true,
            draftEnabled: draft.freeContact, onChange: value => change('freeContact', value),
            pendingLabel: text(draft.freeContact ? 'contactPendingOn' : 'contactPendingOff'),
          })}
          {draft.freeContact ? <div className="grid gap-3 border-t border-[var(--nimi-border-subtle)] pt-3">
            <div className={fieldRowClass}>
              <label className="min-w-0 flex-1 text-[length:var(--nimi-type-body-sm-size)]" htmlFor="agent-center-contact-limit">{text('contactLimit')}</label>
              <input id="agent-center-contact-limit" aria-describedby={fieldError('contactLimit')} aria-invalid={validationError === 'contactLimit' || undefined} aria-label={text('contactLimit')} className={cnAgentCenter(agentCenterInputClassName, 'w-20 text-center tabular-nums')} type="number" min={1} max={24} step={1} value={draft.limit} onChange={event => change('limit', event.currentTarget.value)} required />
            </div>
            <p className={helpClass}>{text('contactLimitHelp')}</p>
            <div className="flex items-center justify-between gap-4 border-t border-[var(--nimi-border-subtle)] pt-3">
              <div className="min-w-0">
                <span className="text-[length:var(--nimi-type-body-sm-size)] font-medium">{text('quiet')}</span>
                <p className={`${helpClass} mt-1`}>{text('quietHelp')}</p>
              </div>
              <Toggle checked={draft.quiet} ariaLabel={text('quiet')} onChange={value => change('quiet', value)} />
            </div>
            {draft.quiet ? <div className="grid gap-3 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] p-3">
              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>{text('quietStart')}<input aria-describedby={quietHoursInvalid ? errorId : undefined} aria-invalid={quietHoursInvalid || undefined} aria-label={text('quietStart')} className={agentCenterInputClassName} type="time" value={draft.start} onChange={event => change('start', event.currentTarget.value)} required /></label>
                <label className={labelClass}>{text('quietEnd')}<input aria-describedby={quietHoursInvalid ? errorId : undefined} aria-invalid={quietHoursInvalid || undefined} aria-label={text('quietEnd')} className={agentCenterInputClassName} type="time" value={draft.end} onChange={event => change('end', event.currentTarget.value)} required /></label>
              </div>
              <p className={helpClass}>{text('quietDaysHelp')}</p>
              <label className={labelClass}>{text('timezone')}<input aria-describedby={fieldError('timezone')} aria-invalid={validationError === 'timezone' || undefined} aria-label={text('timezone')} className={agentCenterInputClassName} value={draft.timezone} onChange={event => change('timezone', event.currentTarget.value)} required /></label>
            </div> : null}
          </div> : null}
        </Card>
        <Card className="grid gap-3 p-4">
          {settingHeader({
            title: text('lifeEnabled'), description: text('lifeHelp'), enabled: autonomy.enabled === true,
            draftEnabled: draft.enabled, onChange: value => change('enabled', value),
            pendingLabel: text(draft.enabled ? 'lifePendingOn' : 'lifePendingOff'),
          })}
          {draft.enabled ? <div className="border-t border-[var(--nimi-border-subtle)] pt-3">
            <label className={labelClass}>{text('frequency')}
              <select aria-label={text('frequency')} className={cnAgentCenter(agentCenterInputClassName, 'w-full')} value={draft.mode} onChange={event => change('mode', event.currentTarget.value as typeof draft.mode)}>
                <option value="low">{text('low')}</option><option value="medium">{text('medium')}</option><option value="high">{text('high')}</option>
              </select>
            </label>
            <p className={`${helpClass} mt-1.5`}>{text('frequencyHelp')}</p>
          </div> : null}
        </Card>
        <Card>
          <details ref={budgetDetails} className="group">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-4 [&::-webkit-details-marker]:hidden">
              <span className="text-[length:var(--nimi-type-body-sm-size)] font-semibold">{text('budget')}</span>
              <span className="text-[length:var(--nimi-type-caption-size)] tabular-nums text-[var(--nimi-text-secondary)]">{text('used')} · {used} / {allowance}</span>
            </summary>
            <div className="grid gap-3 border-t border-[var(--nimi-border-subtle)] p-4">
              <p className={helpClass}>{text('budgetHelp')}</p>
              <div className="grid gap-3">
                <label className={labelClass}>{text('daily')}<input aria-describedby={fieldError('daily')} aria-invalid={validationError === 'daily' || undefined} aria-label={text('daily')} className={agentCenterInputClassName} type="number" min={0} step={1} value={draft.daily} onChange={event => change('daily', event.currentTarget.value)} required /><span className={helpClass}>{text('dailyHelp')}</span></label>
                <label className={labelClass}>{text('output')}<input aria-describedby={fieldError('output')} aria-invalid={validationError === 'output' || undefined} aria-label={text('output')} className={agentCenterInputClassName} type="number" min={0} max={2147483647} step={1} value={draft.output} onChange={event => change('output', event.currentTarget.value)} required /><span className={helpClass}>{text('outputHelp')}</span></label>
              </div>
            </div>
          </details>
          {autonomy.budgetExhausted ? <div className="grid gap-2 px-4 pb-4">
            <InlineAlert tone="warning">{text('exhausted')}</InlineAlert>
            {autonomy.windowStartedAt ? <p className={helpClass}>{text('windowResets')} {new Date(Date.parse(autonomy.windowStartedAt) + 86_400_000).toLocaleString(i18n?.language ?? undefined)}</p> : null}
          </div> : null}
        </Card>
      </fieldset>
      <AgentCenterLifePanel session={session} snapshot={snapshot} i18n={i18n} />
      {showSaveBar ? <div className="sticky bottom-0 z-10 grid gap-2 rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 shadow-[var(--nimi-elevation-raised)]" data-agent-center-behavior-save-bar="true">
        {validationError ? <InlineAlert tone="danger"><span id={errorId}>{text(`validation.${validationError}`)}</span></InlineAlert> : null}
        {notice === 'failed' ? <InlineAlert tone="danger">{text('failed')}</InlineAlert> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span role="status" className={cnAgentCenter('min-w-0 flex-1 text-[length:var(--nimi-type-caption-size)] leading-[1.45]', notice === 'saved' && !dirty ? 'text-[var(--nimi-status-success-soft-text)]' : 'text-[var(--nimi-text-secondary)]')}>
            {remoteChanged ? text('remoteChanged') : saving ? text('saving') : dirty ? text('unsaved') : notice === 'saved' ? text('saved') : ''}
          </span>
          {dirty || remoteChanged || saving ? <div className="flex shrink-0 items-center gap-2">
            <Button type="button" tone="ghost" size="sm" disabled={saving} onClick={reset}>{text('reset')}</Button>
            <Button type="submit" tone="primary" size="sm" disabled={!dirty || saving || !available || remoteChanged}>{saving ? text('saving') : text('save')}</Button>
          </div> : null}
        </div>
      </div> : null}
    </form>
  </SectionShell>;
}

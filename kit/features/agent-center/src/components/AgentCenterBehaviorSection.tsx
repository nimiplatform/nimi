import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert, Toggle } from '@nimiplatform/kit/ui';
import { translateAgentCenter } from '../i18n.js';
import { getAgentCenterMessage } from '../locales/index.js';
import type { AgentCenterAutonomyMutationInput, AgentCenterAutonomyState, AgentCenterI18n, AgentCenterPlacementActions, AgentCenterSession, AgentCenterSnapshot } from '../types.js';
import { Card, SectionHeader, SectionShell, agentCenterInputClassName } from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';
import { AgentCenterLifePanel } from './AgentCenterLifePanel.js';

export interface AgentCenterBehaviorSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
  readonly placementActions?: AgentCenterPlacementActions;
}
function deviceTimezone(): string { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } }
function clock(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }
function minutes(value: string): number { const [hour, minute] = value.split(':').map(Number); return hour! * 60 + minute!; }
function draftOf(value: AgentCenterAutonomyState) {
  return { enabled: value.enabled === true, mode: (value.mode && value.mode !== 'off' ? value.mode : 'low') as AgentCenterAutonomyMutationInput['mode'],
    daily: value.dailyTokenBudget === null ? '' : String(value.dailyTokenBudget), output: value.maxBackgroundOutputTokens === null ? '' : String(value.maxBackgroundOutputTokens),
    freeContact: value.freeContactEnabled === true, limit: String(value.maxFreeContactsPerDay ?? 3), quiet: value.quietHours !== null,
    timezone: value.quietHours?.timezone ?? deviceTimezone(), start: clock(value.quietHours?.startMinute ?? 1320), end: clock(value.quietHours?.endMinute ?? 480) };
}

export function AgentCenterBehaviorSection({ session, snapshot, i18n, placementActions }: AgentCenterBehaviorSectionProps) {
  const autonomy = snapshot.state.autonomy;
  const [draft, setDraft] = useState(() => draftOf(autonomy));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'failed' | null>(null);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const edited = useRef(false);
  const base = useRef({ session, revision: autonomy.revision });
  const current = useRef<AgentCenterSession | null>(session); current.current = session;
  useEffect(() => { current.current = session; return () => { current.current = null; }; }, [session]);
  useEffect(() => {
    if (base.current.session === session && base.current.revision === autonomy.revision) return;
    if (base.current.session === session && edited.current) { setRemoteChanged(true); return; }
    base.current = { session, revision: autonomy.revision };
    edited.current = false;
    setDraft(draftOf(autonomy)); setRemoteChanged(false); setNotice(null);
  }, [session, autonomy.revision]);
  const text = (key: string) => { const id = `AgentCenter.lifeSettings.${key}`; return translateAgentCenter(i18n, id, getAgentCenterMessage('en', id) ?? ''); };
  const change = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => { edited.current = true; setNotice(null); setDraft(old => ({ ...old, [key]: value })); };
  const reset = () => {
    edited.current = false; base.current = { session, revision: autonomy.revision };
    setDraft(draftOf(autonomy)); setRemoteChanged(false); setNotice(null);
  };
  const available = snapshot.availability.updateAutonomy.state === 'available' && !autonomy.controlsDisabled;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(autonomy));
  const save = async () => {
    if (!available || !base.current.revision || saving || remoteChanged) return;
    setSaving(true); setNotice(null);
    try {
      if (!/^\d+$/u.test(draft.daily) || !/^\d+$/u.test(draft.output) || !/^\d+$/u.test(draft.limit)) throw new Error('Invalid budget');
      await session.updateAutonomy({ expectedRevision: base.current.revision, enabled: draft.enabled, mode: draft.mode,
        dailyTokenBudget: Number(draft.daily), maxBackgroundOutputTokens: Number(draft.output), freeContactEnabled: draft.freeContact,
        maxFreeContactsPerDay: Number(draft.limit), quietHours: draft.quiet ? { timezone: draft.timezone, startMinute: minutes(draft.start), endMinute: minutes(draft.end) } : null });
      if (current.current === session) {
        const saved = session.getSnapshot().state.autonomy;
        edited.current = false; base.current = { session, revision: saved.revision };
        setRemoteChanged(false); setDraft(draftOf(saved)); setNotice('saved');
      }
    } catch { if (current.current === session) setNotice('failed'); } finally { if (current.current === session) setSaving(false); }
  };
  const labelClass = 'grid min-w-0 gap-1.5 text-sm text-[var(--nimi-text-primary)]';
  const helpClass = 'text-sm leading-relaxed text-[var(--nimi-text-secondary)]';
  return <SectionShell labelledBy="agent-center-behavior-title">
    <SectionHeader id="agent-center-behavior-title" title={text('title')} description={text('description')} />
    <AgentCenterProductActionNotice action="updateAutonomy" availability={snapshot.availability.updateAutonomy} session={session} i18n={i18n} onOpenRuntimeSettings={placementActions?.openRuntimeSettings} />
    <AgentCenterLifePanel session={session} snapshot={snapshot} i18n={i18n} />
    <Card>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4">
          <Button type="submit" tone="primary" size="sm" disabled={!dirty || saving || !available || remoteChanged}>{saving ? text('saving') : text('save')}</Button>
          <Button type="button" tone="ghost" size="sm" disabled={(!dirty && !remoteChanged) || saving} onClick={reset}>{text('reset')}</Button>
          <span role="status" className="text-sm text-[var(--nimi-text-secondary)]">{remoteChanged ? text('remoteChanged') : dirty ? text('unsaved') : notice === 'saved' ? text('saved') : ''}</span>
        </div>
        <fieldset disabled={!available || saving} className="m-0 grid min-w-0 gap-5 border-0 p-4">
          <section className="grid gap-3">
            <label className="flex items-center justify-between gap-4 font-medium">
              {text('lifeEnabled')}<Toggle checked={draft.enabled} ariaLabel={text('lifeEnabled')} disabled={!available || saving} onChange={value => change('enabled', value)} />
            </label>
            <p className={helpClass}>{text('lifeHelp')}</p>
            <label className={labelClass}>{text('frequency')}
              <select className={agentCenterInputClassName} value={draft.mode} onChange={event => change('mode', event.currentTarget.value as typeof draft.mode)}>
                <option value="low">{text('low')}</option><option value="medium">{text('medium')}</option><option value="high">{text('high')}</option>
              </select>
            </label>
          </section>
          <section className="grid gap-3 border-t border-[var(--nimi-border-subtle)] pt-4">
            <label className="flex items-center justify-between gap-4 font-medium">
              {text('freeContact')}<Toggle checked={draft.freeContact} ariaLabel={text('freeContact')} disabled={!available || saving} onChange={value => change('freeContact', value)} />
            </label>
            <p className={helpClass}>{text('freeHelp')}</p>
            <label className={labelClass}>{text('contactLimit')}<input className={agentCenterInputClassName} type="number" min={draft.freeContact ? 1 : 0} max={24} step={1} value={draft.limit} onChange={event => change('limit', event.currentTarget.value)} /></label>
            <p className={helpClass}>{text('contactLimitHelp')}</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.quiet} onChange={event => change('quiet', event.currentTarget.checked)} />{text('quiet')}</label>
            {draft.quiet ? <div className="grid grid-cols-2 gap-3">
              <label className={labelClass}>{text('quietStart')}<input className={agentCenterInputClassName} type="time" value={draft.start} onChange={event => change('start', event.currentTarget.value)} required /></label>
              <label className={labelClass}>{text('quietEnd')}<input className={agentCenterInputClassName} type="time" value={draft.end} onChange={event => change('end', event.currentTarget.value)} required /></label>
              <label className={`${labelClass} col-span-2`}>{text('timezone')}<input className={agentCenterInputClassName} value={draft.timezone} onChange={event => change('timezone', event.currentTarget.value)} required /></label>
            </div> : null}
          </section>
          <section className="grid gap-3 border-t border-[var(--nimi-border-subtle)] pt-4">
            <h3 className="font-medium">{text('budget')}</h3><p className={helpClass}>{text('budgetHelp')}</p>
            <p className="text-sm tabular-nums">{text('used')}: {autonomy.usedTokensInWindow?.toLocaleString() ?? '—'} / {autonomy.dailyTokenBudget === 0 ? text('unlimited') : autonomy.dailyTokenBudget?.toLocaleString() ?? '—'}</p>
            {autonomy.budgetExhausted ? <InlineAlert tone="warning">{text('exhausted')}</InlineAlert> : null}
            {autonomy.budgetExhausted && autonomy.windowStartedAt ? <p className={helpClass}>{text('windowResets')} {new Date(Date.parse(autonomy.windowStartedAt) + 86_400_000).toLocaleString(i18n?.language ?? undefined)}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>{text('daily')}<input className={agentCenterInputClassName} type="number" min={0} step={1} value={draft.daily} onChange={event => change('daily', event.currentTarget.value)} required /><span className={helpClass}>{text('dailyHelp')}</span></label>
              <label className={labelClass}>{text('output')}<input className={agentCenterInputClassName} type="number" min={0} max={2147483647} step={1} value={draft.output} onChange={event => change('output', event.currentTarget.value)} required /><span className={helpClass}>{text('outputHelp')}</span></label>
            </div>
          </section>
        </fieldset>
        {notice ? <div className="px-4 pb-4"><InlineAlert tone={notice === 'saved' ? 'success' : 'danger'}>{text(notice)}</InlineAlert></div> : null}
      </form>
    </Card>
  </SectionShell>;
}

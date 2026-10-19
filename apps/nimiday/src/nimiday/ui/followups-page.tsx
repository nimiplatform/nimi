import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { invoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { useNimiDay } from '../app/context.js';
import { canContinueFollowUp, notificationState, type FollowUpContinueInput, type FollowUpSnapshot, type FollowUp } from '../followup/engine.js';
import { Card, Chip, PageHead } from './common.js';
import { IntegrationReferencePanel } from './integration-reference-panel.js';
import { CalendarCheck2, Plus, ShieldCheck } from 'lucide-react';
import { FollowUpComposer } from './followup-composer.js';
import { FollowUpConnectionActions } from './followup-connection-actions.js';
import { affectedFollowUps, isFollowUpTarget } from '../followup/connection-state.js';
import './followups-page.css';

const active = new Set<FollowUp['state']>(['preparing', 'notifying', 'waiting', 'waiting-agent', 'reviewing']);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const stateTone: Record<FollowUp['state'], 'info' | 'success' | 'warning' | 'danger' | 'accent' | undefined> = {
  preparing: 'info', notifying: 'info', waiting: 'info', 'waiting-agent': 'accent', reviewing: 'info',
  'needs-input': 'warning', completed: 'success', stopped: undefined, interrupted: 'danger', failed: 'danger', unconfirmed: 'warning',
};

function FollowUpCard({ item, changed }: { item: FollowUp; changed: () => Promise<void> }) {
  const { copy } = useNimiDay(); const text = copy.followups;
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const sent = item.recipients.every(recipient => recipient.sent);
  const act = async (command: string, payload: Record<string, unknown>) => {
    setBusy(true); setError('');
    try { await invoke(command, payload); await changed(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  const continueWork = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const input: FollowUpContinueInput = { id: item.id, decision: values.decision!, ...(!sent ? { when: values.when!, notice: values.notice! } : {}) };
    void act('nimiday.followups.continue', { input });
  };
  const canEnd = !active.has(item.state) && item.state !== 'completed' && item.state !== 'stopped';
  return <div id={`followup-${item.id}`} tabIndex={-1} className="nd-followup-record"><Card title={item.title} action={<Chip tone={stateTone[item.state]}>{text.state[item.state]}</Chip>}>
    <p className="nd-followup-when">{item.when}</p>
    <div className="nd-followup-progress"><span>{text.sentProgress(item.recipients.filter(recipient => recipient.sent).length, item.recipients.length)}</span><span>{text.confirmedProgress(item.recipients.filter(recipient => recipient.response === 'confirmed').length, item.recipients.length)}</span></div>
    <details className="nd-followup-record-details"><summary>{text.arrangementDetails}</summary><p>{item.goal}</p><blockquote>{item.notice}</blockquote></details>
    <ul className="nd-followup-recipients">{item.recipients.map(recipient => <li key={recipient.chatId}>
      <div><strong>{recipient.label}</strong>{recipient.note && <p>{recipient.note}</p>}</div><div className="nd-followup-person-status"><span>{text.notification[notificationState(item, recipient)]}</span>{recipient.sent && <Chip tone={recipient.response === 'confirmed' ? 'success' : recipient.response === 'declined' || recipient.response === 'unclear' ? 'warning' : undefined}>{text.response[recipient.response]}</Chip>}</div>
    </li>)}</ul>
    {item.analysis && <details open={item.state === 'needs-input'}>
      <summary>{text.analysisPhase[item.analysisPhase || 'history']}</summary>
      <p style={{ whiteSpace: 'pre-wrap' }}>{item.analysis}</p>
    </details>}
    {(item.issue || item.error) && <InlineAlert tone="warning">{item.issue ? text.issue[item.issue] : item.error}</InlineAlert>}
    {error && <InlineAlert tone="warning">{error}</InlineAlert>}
    {item.replies.length > 0 && <details><summary>{text.received(item.replies.length)}</summary>{item.replies.map(reply => <p key={reply.updateId}>{item.recipients.find(value => value.chatId === reply.chatId)?.label || text.participant}：{reply.text}</p>)}</details>}
    {item.decisions?.length ? <details><summary>{text.decisionHistory}</summary><ul>{item.decisions.map((decision, index) => <li key={`${decision.at}:${index}`}>{decision.text}</li>)}</ul></details> : null}
    {canContinueFollowUp(item) && <form onSubmit={continueWork} aria-label={`${text.continueTitle} · ${item.title}`} className="nd-followup-form" style={{ marginTop: 12 }}>
      <strong>{text.continueTitle}</strong><p className="nd-faint">{sent ? text.sentHint : text.unsentHint}</p>
      {!sent && <><label>{text.when}<input name="when" required defaultValue={item.when} maxLength={200} disabled={busy} /></label><label>{text.notice}<textarea name="notice" required defaultValue={item.notice} rows={4} maxLength={3000} disabled={busy} /></label></>}
      <label>{text.decision}<textarea name="decision" required rows={3} maxLength={650} placeholder={text.decisionHint} disabled={busy} /></label>
      <Button type="submit" tone="primary" size="sm" loading={busy}>{sent ? text.continueSent : text.continueUnsent}</Button>
    </form>}
    {item.state === 'unconfirmed' && <p className="nd-faint">{text.unknownHint}</p>}
    {active.has(item.state) && <Button tone="secondary" size="sm" loading={busy} onClick={() => { void act('nimiday.followups.stop', { id: item.id }); }}>{text.stop}</Button>}
    {canEnd && <div style={{ marginTop: 12 }}><p className="nd-faint">{text.endHint}</p><Button tone="secondary" size="sm" loading={busy} onClick={() => { void act('nimiday.followups.stop', { id: item.id }); }}>{text.end}</Button></div>}
    {item.attempt && item.attempt > 1 ? <p className="nd-faint">{text.attempt(item.attempt)}</p> : null}
  </Card></div>;
}

type FollowUpFilter = 'all' | 'attention' | 'active' | 'history';
const needsAttention = (item: FollowUp) => ['needs-input', 'interrupted', 'failed', 'unconfirmed'].includes(item.state);

export function FollowUpsPage({ focusId }: { focusId?: string }) {
  const { copy } = useNimiDay(); const text = copy.followups;
  const [snapshot, setSnapshot] = useState<FollowUpSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftKey, setDraftKey] = useState(0);
  const [filter, setFilter] = useState<FollowUpFilter>('all');
  const [focusTarget, setFocusTarget] = useState(focusId);
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const refreshPending = useRef(false);
  const createButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setFocusTarget(focusId); setCreating(false); }, [focusId]);
  const read = async () => {
    const value = await invoke('nimiday.followups.snapshot') as FollowUpSnapshot;
    if (alive.current) { setSnapshot(value); setLoadError(''); }
  };
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    alive.current = true;
    const poll = async () => {
      try {
        const value = await invoke('nimiday.followups.snapshot') as FollowUpSnapshot;
        if (!stopped) { setSnapshot(value); setLoadError(''); }
      } catch (failure) { if (!stopped) setLoadError(errorText(failure)); }
      if (!stopped) timer = setTimeout(() => { void poll(); }, 1000);
    };
    void poll();
    return () => { stopped = true; alive.current = false; clearTimeout(timer); };
  }, []);
  const focusedOnce = useRef('');
  useEffect(() => {
    if (!focusTarget || creating || !snapshot?.arrangements.some(item => item.id === focusTarget) || focusedOnce.current === focusTarget) return;
    if (filter !== 'all') { setFilter('all'); return; }
    const element = document.getElementById(`followup-${focusTarget}`);
    if (element) { element.scrollIntoView({ block: 'center' }); element.focus({ preventScroll: true }); focusedOnce.current = focusTarget; }
  }, [focusTarget, snapshot, creating, filter]);
  const refresh = useCallback(async () => {
    if (refreshPending.current) return;
    refreshPending.current = true;
    setRefreshing(true); setError('');
    try { const value = await invoke('nimiday.followups.refresh') as FollowUpSnapshot; if (alive.current) setSnapshot(value); }
    catch (failure) { if (alive.current) setError(errorText(failure)); }
    finally { refreshPending.current = false; if (alive.current) setRefreshing(false); }
  }, []);
  useEffect(() => {
    const check = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [refresh]);
  const targets = snapshot?.targets.filter(target => target.available && isFollowUpTarget(target)) || [];
  const missingAccount = snapshot?.ready && targets.length === 0;
  const missingAgent = snapshot?.ready && snapshot.agents.length === 0;
  const arrangements = snapshot?.arrangements || [];
  const affected = affectedFollowUps(snapshot);
  const affectedAccount = affected.some(item => !targets.some(target => target.targetRef === item.targetRef));
  const affectedAgent = affected.some(item => !snapshot?.agents.some(agent => agent.agentBinding === item.agentBinding));
  const setupHint = <div className="nd-followup-setup-hint">
    <p>{text.setupDraftHint}</p>
    <FollowUpConnectionActions account={Boolean(missingAccount)} agent={Boolean(missingAgent)} />
  </div>;
  const counts = { all: arrangements.length, attention: arrangements.filter(needsAttention).length, active: arrangements.filter(item => active.has(item.state)).length, history: arrangements.filter(item => item.state === 'completed' || item.state === 'stopped').length };
  const visible = arrangements.filter(item => filter === 'all' || (filter === 'attention' ? needsAttention(item) : filter === 'active' ? active.has(item.state) : item.state === 'completed' || item.state === 'stopped'))
    .sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || Number(active.has(b.state)) - Number(active.has(a.state)) || b.updatedAt.localeCompare(a.updatedAt));
  const openCreate = () => { setCreating(true); setNotice(''); };
  return <div className="nd-page nd-followups-page" data-testid="nd-followups">
    <PageHead title={creating ? text.create : text.title} sub={creating ? text.createIntro : text.intro} action={!creating ? <Button ref={createButton} tone="primary" onClick={openCreate}><Plus size={17} aria-hidden="true" />{text.newArrangement}</Button> : undefined} />
    {error || loadError || snapshot?.error ? <InlineAlert tone="warning">{error || loadError || snapshot?.error}</InlineAlert> : null}
    {notice && <div role="status" className="nd-followup-success"><ShieldCheck size={18} aria-hidden="true" />{notice}</div>}
    {!creating && affected.length > 0 && <div className="nd-followup-connection-warning" role="status">
      <strong>{text.connectionAffected(affected.length)}</strong>
      <p>{text.connectionAffectedHint}</p>
      <ul>{affected.map(item => <li key={item.id}><a href={`#followup-${item.id}`} onClick={event => { event.preventDefault(); focusedOnce.current = ''; setFilter('all'); setFocusTarget(item.id); }}>{item.title}</a></li>)}</ul>
      <FollowUpConnectionActions account={affectedAccount} agent={affectedAgent} refresh={refresh} refreshing={refreshing} />
    </div>}
    <div hidden={!creating}>
      <FollowUpComposer key={draftKey} snapshot={snapshot} visible={creating} refresh={refresh} refreshing={refreshing} onBack={() => { setCreating(false); requestAnimationFrame(() => createButton.current?.focus()); }} onCreated={id => { setCreating(false); setDraftKey(value => value + 1); setFocusTarget(id); setFilter('all'); setNotice(text.created); void read().catch(failure => setError(errorText(failure))); }} />
    </div>
    {!creating && <>
      <div className="nd-followup-filters" role="group" aria-label={text.filterLabel}>
        {(['all', 'attention', 'active', 'history'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{text.filters[value]}<span>{snapshot?.ready ? counts[value] : '—'}</span></button>)}
      </div>
      {!snapshot?.ready ? <Card><p role="status">{error || loadError || snapshot?.error ? text.loadFailed : copy.common.loading}</p><Button tone="ghost" onClick={() => { void read().catch(failure => setError(errorText(failure))); }}>{copy.common.retry}</Button></Card>
        : !arrangements.length ? <Card className="nd-followup-empty">
          <div className="nd-followup-empty-icon"><CalendarCheck2 size={30} strokeWidth={1.5} aria-hidden="true" /></div>
          <h2>{text.emptyTitle}</h2><p>{text.emptyBody}</p>
          <ol className="nd-followup-how">{text.howItWorks.map((item, index) => <li key={item.title}><span>{index + 1}</span><strong>{item.title}</strong><p>{item.body}</p></li>)}</ol>
          <Button tone="primary" onClick={openCreate}><Plus size={16} aria-hidden="true" />{text.firstArrangement}</Button>
          <p className="nd-faint">{text.preSendHint}</p>
          {(missingAccount || missingAgent) && setupHint}
        </Card>
        : <div className="nd-stack">{visible.length ? visible.map(item => <FollowUpCard key={item.id} item={item} changed={read} />) : <Card><p className="nd-followup-filter-empty">{text.filterEmpty}</p></Card>}</div>}
      {arrangements.length > 0 && affected.length === 0 && (missingAccount || missingAgent) && setupHint}
      <details className="nd-followup-resources"><summary>{text.referenceTools}</summary><IntegrationReferencePanel targets={snapshot?.targets || []} ready={snapshot?.ready === true && !snapshot.error} refresh={refresh} /></details>
    </>}
    <div className="nd-followup-runtime"><ShieldCheck size={15} aria-hidden="true" /><p>{text.runtimeHint}</p></div>
  </div>;
}

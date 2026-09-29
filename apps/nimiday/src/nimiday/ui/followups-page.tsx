import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, ConfirmDialog, InlineAlert } from '@nimiplatform/kit/ui';
import { invoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { useDayStore, useNimiDay } from '../app/context.js';
import { parseGoVersionReference } from '../domain/integration-reference.js';
import { parseRecipientLines } from '../domain/followup-recipients.js';
import { canContinueFollowUp, notificationState, type FollowUpContinueInput, type FollowUpInput, type FollowUpSnapshot, type FollowUp } from '../followup/engine.js';
import { Card, PageHead } from './common.js';
import { IntegrationReferencePanel } from './integration-reference-panel.js';
import { GoVersionReferenceField } from './go-version-reference-field.js';

const active = new Set<FollowUp['state']>(['preparing', 'notifying', 'waiting', 'waiting-agent', 'reviewing']);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

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
  return <div id={`followup-${item.id}`}><Card title={item.title}>
    <p><strong>{text.state[item.state]}</strong> · {item.when}</p><p>{item.goal}</p>
    <ul>{item.recipients.map(recipient => <li key={recipient.chatId}>
      {recipient.label}：{text.notification[notificationState(item, recipient)]}
      {recipient.sent && ` · ${text.response[recipient.response]}`}{recipient.note ? ` · ${recipient.note}` : ''}
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

export function FollowUpsPage({ focusId }: { focusId?: string }) {
  const { state } = useDayStore(); const { copy } = useNimiDay(); const text = copy.followups;
  const [snapshot, setSnapshot] = useState<FollowUpSnapshot | null>(null);
  const [error, setError] = useState(''); const [sending, setSending] = useState(false);
  const [sourceRef, setSourceRef] = useState(''); const [sourceReference, setSourceReference] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [confirming, setConfirming] = useState<{ input: FollowUpInput; account: string } | null>(null);
  const parsed = useMemo(() => parseRecipientLines(recipientText, text.recipientFallback), [recipientText, text]);
  const read = async () => { const value = await invoke('nimiday.followups.snapshot') as FollowUpSnapshot; setSnapshot(value); };
  useEffect(() => { void read().catch(failure => setError(errorText(failure))); const timer = setInterval(() => { void read().catch(failure => setError(errorText(failure))); }, 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (focusId && snapshot) document.getElementById(`followup-${focusId}`)?.scrollIntoView({ block: 'center' }); }, [focusId, snapshot?.ready]);
  // Nothing is sent until the parsed recipients and the exact notice are confirmed.
  const start = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    if (parsed.problems.length > 0 || parsed.recipients.length === 0) { setError(text.recipientFix); return; }
    try {
      const recipients = parsed.recipients.map(recipient => ({ chatId: recipient.chatId, label: recipient.label }));
      const input: FollowUpInput = { title: values.title!, when: values.when!, goal: values.goal!, notice: values.notice!, publishHome: values.publishHome === 'on', targetRef: values.targetRef!, agentBinding: values.agentBinding!, recipients, ...(sourceRef ? { source: { targetRef: sourceRef, reference: parseGoVersionReference(sourceReference, copy.references).reference } } : {}) };
      const target = snapshot?.targets.find(value => value.targetRef === input.targetRef);
      setConfirming({ input, account: target ? `${target.displayName} · ${target.accountLabel}` : input.targetRef });
    } catch (failure) { setError(errorText(failure)); }
  };
  const send = async () => {
    if (!confirming) return;
    setSending(true); setError('');
    try { await invoke('nimiday.followups.start', { input: confirming.input }); setConfirming(null); await read(); }
    catch (failure) { setConfirming(null); setError(errorText(failure)); }
    finally { setSending(false); }
  };
  const sources = snapshot?.targets.filter(target => target.integrationId === 'nimi.go.deliverables' && target.permittedOperations.includes('deliverable.read')) || [];
  const targets = snapshot?.targets.filter(target => target.kind === 'telegram' && ['telegram.sendMessage', 'telegram.updates.read'].every(name => target.permittedOperations.includes(name))) || [];
  return <div className="nd-page nd-page--narrow" data-testid="nd-followups">
    <PageHead title={text.title} /><p className="nd-muted">{text.intro}</p>
    {error || snapshot?.error ? <InlineAlert tone="warning">{error || snapshot?.error}</InlineAlert> : null}
    <IntegrationReferencePanel targets={snapshot?.targets || []} refresh={async () => { const value = await invoke('nimiday.followups.refresh') as FollowUpSnapshot; setSnapshot(value); }} />
    <Card title={text.create}><form onSubmit={start} aria-label={text.create} className="nd-followup-form">
      <label>{text.name}<input name="title" required maxLength={100} placeholder={text.nameHint} /></label>
      <label>{text.when}<input name="when" required maxLength={200} placeholder={text.whenHint} /></label>
      <label>{text.goal}<textarea name="goal" required maxLength={1500} rows={3} placeholder={text.goalHint} /></label>
      <label>{text.agent}<select name="agentBinding" required defaultValue={state.profile.appointment?.binding || ''}><option value="">{text.chooseAgent}</option>{snapshot?.agents.map(agent => <option value={agent.agentBinding} key={agent.agentBinding}>{agent.displayName}</option>)}</select></label>
      <label>{text.account}<select name="targetRef" required><option value="">{text.chooseAccount}</option>{targets.map(target => <option value={target.targetRef} key={target.targetRef}>{target.displayName} · {target.accountLabel}</option>)}</select></label>
      {targets.length === 0 && <p className="nd-faint">{text.noAccount}</p>}
      <label>{text.recipients}<textarea name="recipients" required rows={3} placeholder={text.recipientsHint} value={recipientText} onChange={event => setRecipientText(event.target.value)} aria-invalid={parsed.problems.length > 0} aria-describedby="nd-recipient-check" /></label>
      <div id="nd-recipient-check" aria-live="polite">
        {parsed.problems.map(problem => <p key={`${problem.line}:${problem.reason}`} className="nd-field-error" role="alert">{text.recipientProblems[problem.reason](problem.line, problem.value)}</p>)}
        {parsed.recipients.length > 0 && <ul className="nd-faint" data-testid="nd-recipient-echo">{parsed.recipients.map(recipient => <li key={recipient.chatId}>{text.recipientEcho(recipient.line, recipient.named ? recipient.label : `${recipient.label}（${text.recipientUnnamed}）`, recipient.chatId)}</li>)}</ul>}
      </div>
      <details><summary>{text.recipientHelp}</summary><ol>{text.recipientSteps.map(step => <li key={step}>{step}</li>)}</ol></details>
      <label>{text.notice}<textarea name="notice" required rows={4} maxLength={3000} placeholder={text.noticeHint} /></label>
      <label>{text.source}<select value={sourceRef} onChange={event => setSourceRef(event.target.value)}><option value="">{text.noSource}</option>{sources.map(target => <option value={target.targetRef} key={target.targetRef}>{target.displayName}</option>)}</select></label>
      {sourceRef && <GoVersionReferenceField value={sourceReference} onChange={setSourceReference} required disabled={sending} />}
      <label><span><input name="publishHome" type="checkbox" defaultChecked={state.profile.homeMessages} style={{ width: 'auto' }} /> {text.publishHome}</span></label>
      <Button type="submit" tone="primary" loading={sending} disabled={!snapshot?.ready || targets.length === 0}>{text.start}</Button>
    </form></Card>
    <ConfirmDialog
      open={confirming !== null}
      title={text.confirmTitle}
      message={confirming ? <div>
        <p>{text.confirmBody(confirming.input.recipients.length, confirming.account)}</p>
        <ul>{parsed.recipients.map(recipient => <li key={recipient.chatId}>{text.recipientEcho(recipient.line, recipient.label, recipient.chatId)}</li>)}</ul>
        <blockquote style={{ whiteSpace: 'pre-wrap' }}>{confirming.input.notice}</blockquote>
      </div> : null}
      confirmLabel={text.confirmSend}
      cancelLabel={text.confirmCancel}
      confirmTone="primary"
      loading={sending}
      onConfirm={() => { void send(); }}
      onClose={() => setConfirming(null)}
    />
    {snapshot?.arrangements.map(item => <FollowUpCard key={item.id} item={item} changed={read} />)}
  </div>;
}

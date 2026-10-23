import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Send } from 'lucide-react';
import { Button, ConfirmDialog, InlineAlert, SelectField } from '@nimiplatform/kit/ui';
import { invoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { useDayStore, useNimiDay } from '../app/context.js';
import { parseRecipientLines } from '../domain/followup-recipients.js';
import { parseGoVersionReference } from '../domain/integration-reference.js';
import type { FollowUpInput, FollowUpSnapshot } from '../followup/engine.js';
import { Card } from './common.js';
import { GoVersionReferenceField } from './go-version-reference-field.js';
import { FollowUpConnectionActions } from './followup-connection-actions.js';
import { isFollowUpTarget } from '../followup/connection-state.js';
import { useUi } from './ui-context.js';

export function FollowUpComposer({ snapshot, visible, refresh, refreshing, onCreated, onBack }: {
  snapshot: FollowUpSnapshot | null;
  visible: boolean;
  refresh: () => Promise<void>;
  refreshing: boolean;
  onCreated: (id: string) => void;
  onBack: () => void;
}) {
  const { state } = useDayStore();
  const { copy } = useNimiDay();
  const text = copy.followups;
  const { followUpDraft } = useUi();
  const [step, setStep] = useState(followUpDraft.current?.step ?? 0);
  const [draft, setDraft] = useState(followUpDraft.current?.content ?? { title: '', when: '', goal: '', notice: '', recipients: '', targetRef: '', agentBinding: state.profile.appointment?.binding || '', publishHome: state.profile.homeMessages });
  const [sourceRef, setSourceRef] = useState(followUpDraft.current?.sourceRef ?? '');
  const [sourceReference, setSourceReference] = useState(followUpDraft.current?.sourceReference ?? '');
  useEffect(() => {
    followUpDraft.current = { step, content: draft, sourceRef, sourceReference };
  }, [followUpDraft, step, draft, sourceRef, sourceReference]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [neededSetup, setNeededSetup] = useState(false);
  const [confirming, setConfirming] = useState<{ input: FollowUpInput; account: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (visible) heading.current?.focus(); }, [step, visible]);
  const parsed = useMemo(() => parseRecipientLines(draft.recipients, text.recipientFallback), [draft.recipients, text]);
  const targets = snapshot?.targets.filter(isFollowUpTarget) || [];
  const missingAccount = Boolean(snapshot?.ready && !targets.some(value => value.available));
  const missingAgent = Boolean(snapshot?.ready && !snapshot.agents.length);
  useEffect(() => { if (missingAccount || missingAgent) setNeededSetup(true); }, [missingAccount, missingAgent]);
  const sources = snapshot?.targets.filter(target => target.integrationId === 'nimi.go.deliverables' && target.permittedOperations.includes('deliverable.read')) || [];
  const target = targets.find(value => value.targetRef === draft.targetRef);
  const hasAgent = snapshot?.agents.some(value => value.agentBinding === draft.agentBinding);
  const canSend = Boolean(snapshot?.ready && target?.available && hasAgent);
  const update = (key: 'title' | 'when' | 'goal' | 'notice' | 'recipients', value: string) => setDraft(current => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    if (step === 0) {
      if (![draft.title, draft.when, draft.goal].every(value => value.trim())) { setError(text.requiredFields); return; }
      setStep(1); return;
    }
    if (!canSend) { setError(text.setupNeeded); return; }
    if (parsed.problems.length || !parsed.recipients.length) { setError(text.recipientFix); return; }
    if (!draft.notice.trim()) { setError(text.requiredFields); return; }
    try {
      const input: FollowUpInput = {
        title: draft.title.trim(), when: draft.when.trim(), goal: draft.goal.trim(), notice: draft.notice,
        targetRef: draft.targetRef, agentBinding: draft.agentBinding, publishHome: draft.publishHome,
        recipients: parsed.recipients.map(({ chatId, label }) => ({ chatId, label })),
        ...(sourceRef ? { source: { targetRef: sourceRef, reference: parseGoVersionReference(sourceReference, copy.references).reference } } : {}),
      };
      setConfirming({ input, account: `${target!.displayName} · ${target!.accountLabel}` });
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  const send = async () => {
    if (!confirming || sending) return;
    // Once confirmed, this is a submitted request, not a resumable unsent draft.
    // Leaving this page during start must not offer the same notice for resending.
    followUpDraft.current = null;
    setSending(true); setError('');
    try {
      const result = await invoke('nimiday.followups.start', { input: confirming.input }) as { id: string };
      if (!alive.current) return;
      setConfirming(null); onCreated(result.id);
    } catch (failure) { if (alive.current) {
      followUpDraft.current = { step, content: draft, sourceRef, sourceReference };
      setConfirming(null); setError(failure instanceof Error ? failure.message : String(failure));
    } }
    finally { if (alive.current) setSending(false); }
  };
  return <>
    <div className="nd-followup-composer-head">
      <Button tone="ghost" size="sm" disabled={sending} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{text.backToList}</Button>
      <span className="nd-faint">{text.draftHint}</span>
    </div>
    <Card className="nd-followup-composer">
      <ol className="nd-followup-steps" aria-label={text.create}>
        {[text.groupContent, text.groupDelivery, text.reviewStep].map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} data-done={index < step}><span>{index < step ? <Check size={14} aria-hidden="true" /> : index + 1}</span>{label}</li>)}
      </ol>
      <h2 ref={heading} tabIndex={-1} className="nd-followup-step-title">{step === 0 ? text.contentTitle : text.deliveryTitle}</h2>
      <p className="nd-followup-step-hint">{step === 0 ? text.contentHint : text.deliveryHint}</p>
      <form onSubmit={submit} onInvalidCapture={event => {
        const details = (event.target as HTMLElement).closest('details');
        if (details) details.open = true;
      }} aria-label={text.create} className="nd-followup-form">
        {error && <InlineAlert tone="warning">{error}</InlineAlert>}
        {step === 0 ? <>
          <label>{text.name}<input name="title" required maxLength={100} placeholder={text.nameHint} value={draft.title} onChange={event => update('title', event.target.value)} /></label>
          <label>{text.when}<input name="when" required maxLength={200} placeholder={text.whenHint} value={draft.when} onChange={event => update('when', event.target.value)} /></label>
          <label>{text.goal}<textarea name="goal" required maxLength={1500} rows={3} placeholder={text.goalHint} value={draft.goal} onChange={event => update('goal', event.target.value)} /><span className="nd-faint">{text.goalPrivate}</span></label>
        </> : <>
          <div className="nd-followup-draft-summary"><div><strong>{draft.title}</strong><p>{draft.when}</p></div><Button type="button" tone="ghost" size="sm" onClick={() => setStep(0)}>{copy.common.edit}</Button></div>
          {(missingAccount || missingAgent) && <div className="nd-followup-delivery-setup" role="status">
            <strong>{text.setupTitle}</strong>
            {missingAccount && <p>{text.noAccount}</p>}{missingAgent && <p>{text.noAgent}</p>}
            <p>{text.setupReturnHint}</p>
            <FollowUpConnectionActions account={missingAccount} agent={missingAgent} refresh={refresh} refreshing={refreshing} />
            <Button type="button" tone="ghost" size="sm" onClick={onBack}>{copy.common.later}</Button>
          </div>}
          {neededSetup && snapshot?.ready && !missingAccount && !missingAgent && <p role="status" className="nd-faint">{text.setupReady}</p>}
          <div className="nd-field-row">
            <label>{text.agent}<SelectField required aria-label={text.agent} placeholder={text.chooseAgent} value={hasAgent ? draft.agentBinding : ''} onValueChange={value => setDraft(current => ({ ...current, agentBinding: value }))} options={(snapshot?.agents || []).map(agent => ({ value: agent.agentBinding, label: agent.displayName }))} /></label>
            <label>{text.account}<SelectField required aria-label={text.account} placeholder={text.chooseAccount} value={target ? draft.targetRef : ''} onValueChange={value => setDraft(current => ({ ...current, targetRef: value }))} options={targets.map(value => ({ value: value.targetRef, label: `${value.displayName} · ${value.accountLabel}${value.available ? '' : ` · ${text.unavailable}`}`, disabled: !value.available }))} /></label>
          </div>
          <label>{text.recipients}<textarea name="recipients" required rows={3} placeholder={text.recipientsHint} value={draft.recipients} onChange={event => update('recipients', event.target.value)} aria-invalid={parsed.problems.length > 0} aria-describedby="nd-recipient-check nd-recipient-hint" /><span id="nd-recipient-hint" className="nd-faint">{text.recipientFormat}</span></label>
          <div id="nd-recipient-check" aria-live="polite">
            {parsed.problems.map(problem => <p key={`${problem.line}:${problem.reason}`} className="nd-field-error">{text.recipientProblems[problem.reason](problem.line, problem.value)}</p>)}
            {parsed.recipients.length > 0 && <div className="nd-followup-recipient-preview" data-testid="nd-recipient-echo"><strong>{text.recipientCount(parsed.recipients.length)}</strong>{parsed.recipients.map(recipient => <span key={recipient.chatId}>{recipient.label}<code>{recipient.chatId}</code></span>)}</div>}
          </div>
          <details className="nd-followup-help"><summary>{text.recipientHelp}</summary><ol>{text.recipientSteps.map(value => <li key={value}>{value}</li>)}</ol></details>
          <label>{text.notice}<textarea name="notice" required rows={4} maxLength={3000} placeholder={text.noticeHint} value={draft.notice} onChange={event => update('notice', event.target.value)} /><span className="nd-faint">{text.noticeExact}</span></label>
          <details className="nd-followup-options"><summary>{text.groupExtras}</summary><div className="nd-followup-form">
            <div className="nd-followup-source-field"><label>{text.source}<SelectField aria-label={text.source} placeholder={text.noSource} value={sourceRef} onValueChange={setSourceRef} options={sources.map(value => ({ value: value.targetRef, label: value.displayName, disabled: !value.available }))} /></label>{sourceRef && <Button type="button" size="sm" tone="ghost" onClick={() => { setSourceRef(''); setSourceReference(''); }}>{copy.common.cancel}</Button>}</div>
            {sourceRef && <GoVersionReferenceField value={sourceReference} onChange={setSourceReference} required disabled={sending} />}
          </div></details>
          <label className="nd-check-row"><input name="publishHome" type="checkbox" checked={draft.publishHome} onChange={event => setDraft(current => ({ ...current, publishHome: event.target.checked }))} /><span>{text.publishHome}</span></label>
        </>}
        <div className="nd-followup-wizard-footer">
          {step === 1 ? <Button type="button" tone="ghost" onClick={() => { setError(''); setStep(0); }}>{copy.common.back}</Button> : <span className="nd-faint">{text.requiredHint}</span>}
          <div><Button type="submit" tone="primary" loading={sending} disabled={step === 1 && !canSend}>{step === 0 ? text.nextDelivery : text.start}<ArrowRight size={16} aria-hidden="true" /></Button>{step === 1 && <p className="nd-faint">{canSend ? text.preSendHint : text.setupNeeded}</p>}</div>
        </div>
      </form>
    </Card>
    <ConfirmDialog open={confirming !== null} title={text.confirmTitle} message={confirming ? <div className="nd-followup-confirm">
      <h3>{confirming.input.title}</h3><p>{confirming.input.when}</p>
      <p>{text.confirmBody(confirming.input.recipients.length, confirming.account)}</p>
      <ul>{confirming.input.recipients.map(recipient => <li key={recipient.chatId}>{recipient.label}<code>{recipient.chatId}</code></li>)}</ul>
      <div className="nd-followup-message"><Send size={16} aria-hidden="true" /><blockquote>{confirming.input.notice}</blockquote></div>
    </div> : null} confirmLabel={text.confirmSend} cancelLabel={text.confirmCancel} confirmTone="primary" loading={sending} onConfirm={() => { void send(); }} onClose={() => { if (!sending) setConfirming(null); }} />
  </>;
}

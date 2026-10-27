import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Database, History, MessageCircle, RefreshCw } from 'lucide-react';
import { Button, InlineAlert, Toggle } from '@nimiplatform/kit/ui';
import { asNimiError } from '@nimiplatform/kit/core/sdk-contract';
import { translateAgentCenter } from '../i18n.js';
import { agentCenterEnCatalog } from '../locales/index.js';
import type { AgentCenterI18n, AgentCenterSession, AgentCenterSnapshot, AgentCenterState } from '../types.js';
import { Card, cnAgentCenter } from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';

type CopyKey = Extract<keyof typeof agentCenterEnCatalog, `AgentCenter.conversationContext.${string}`>;
type Selection = NonNullable<AgentCenterState['conversationContext']>;
type HistoryChoice = 'keep' | 'suggested' | 'fresh' | 'full';
type Notice = 'saved' | 'failed' | 'busy' | 'stale' | 'refreshed' | 'refreshFailed';

function ContextStatusRow(props: { readonly icon: ReactNode; readonly label: string; readonly value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)] p-3.5">
      <span className="row-span-2 grid h-9 w-9 place-items-center rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-action-primary-bg)] shadow-[0_2px_6px_color-mix(in_srgb,var(--nimi-text-primary)_4%,transparent)]">
        {props.icon}
      </span>
      <dt className="min-w-0 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
        {props.label}
      </dt>
      <dd className="m-0 min-w-0 break-words text-[length:var(--nimi-type-body-sm-size)] font-semibold leading-[1.45] text-[var(--nimi-text-primary)]">{props.value}</dd>
    </div>
  );
}

function ContextReviewRow(props: {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly changed: boolean;
  readonly beforeLabel: string;
  readonly afterLabel: string;
  readonly unchangedLabel: string;
}) {
  return (
    <div className="border-t border-[var(--nimi-border-subtle)] px-3 py-3 first:border-t-0">
      <dt className="text-sm font-semibold text-[var(--nimi-text-primary)]">{props.label}</dt>
      <dd className="m-0 mt-2 grid gap-1.5 text-sm leading-[1.45]">
        <span className="flex items-start gap-2 text-[var(--nimi-text-secondary)]">
          <span className="shrink-0 text-[var(--nimi-text-muted)]">{props.beforeLabel}</span>
          <span>{props.before}</span>
        </span>
        <span className="flex items-start gap-2 text-[var(--nimi-text-primary)]">
          <span className="shrink-0 text-[var(--nimi-text-muted)]">{props.afterLabel}</span>
          <span className="font-semibold">
            {props.after}
            {!props.changed ? <span className="ml-1 font-normal text-[var(--nimi-text-muted)]">({props.unchangedLabel})</span> : null}
          </span>
        </span>
      </dd>
    </div>
  );
}

// @nimi-authority: rule.nimi.runtime.agent-participation.conversation-context-selection
export function AgentCenterConversationContext({ session, snapshot, i18n, onOpenRuntimeSettings }: {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
  readonly onOpenRuntimeSettings?: () => void;
}) {
  const current = snapshot.state.conversationContext;
  const [base, setBase] = useState<Selection | null>(null);
  const [choice, setChoice] = useState<HistoryChoice>('keep');
  const [omit, setOmit] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const historyGroupName = useId();
  const active = useRef<AgentCenterSession | null>(session);
  active.current = session;
  useEffect(() => {
    setBase(null); setChoice('keep'); setOmit(false); setNotice(null); setPending(false); setRefreshing(false); setConfirming(false);
    return () => { if (active.current === session) active.current = null; };
  }, [session]);
  const text = (key: CopyKey, values: Record<string, string> = {}) => translateAgentCenter(i18n, key, agentCenterEnCatalog[key], values);
  const availability = snapshot.availability.updateConversationContext;
  const unavailable = availability.state !== 'available';
  const stale = base !== null && (!current
    || base.contextRevision !== current.contextRevision
    || base.conversationAnchorId !== current.conversationAnchorId
    || base.committedTurnCount !== current.committedTurnCount
    || base.suggestedFirstTurnSequence !== current.suggestedFirstTurnSequence);
  const first = !base ? '0' : choice === 'fresh' ? base.committedTurnCount
    : choice === 'full' ? '0' : choice === 'suggested' ? base.suggestedFirstTurnSequence ?? base.firstTurnSequence : base.firstTurnSequence;
  const changed = base !== null && (first !== base.firstTurnSequence || omit !== base.omitSupplementalContext);
  const controlsDisabled = pending || refreshing || stale;
  const canSave = changed && !controlsDisabled && !current?.busy && !unavailable;
  const historyExpanded = base !== null && BigInt(first) < BigInt(base.firstTurnSequence);
  const historyValue = (selection: Selection) => selection.firstTurnSequence === '0'
    ? text('AgentCenter.conversationContext.full')
    : text('AgentCenter.conversationContext.range', { count: selection.firstTurnSequence });
  const supplementalValue = (selection: Selection) => selection.omitSupplementalContext
    ? text('AgentCenter.conversationContext.omitted')
    : text('AgentCenter.conversationContext.included');
  const nextSelection = base ? { ...base, firstTurnSequence: first, omitSupplementalContext: omit } : null;
  const begin = () => {
    if (!current) return;
    setBase(current); setChoice('keep'); setOmit(current.omitSupplementalContext); setConfirming(false); setNotice(null);
  };
  const cancel = () => {
    setBase(null); setChoice('keep'); setConfirming(false); setNotice(null);
  };
  const refresh = async () => {
    if (refreshing || pending) return;
    const owner = session;
    setRefreshing(true); setNotice(null);
    try {
      await owner.refresh();
      if (active.current !== owner) return;
      if (owner.getSnapshot().phase !== 'ready') { setNotice('refreshFailed'); return; }
      setBase(null); setChoice('keep'); setConfirming(false); setNotice('refreshed');
    } catch {
      if (active.current === owner) setNotice('refreshFailed');
    } finally {
      if (active.current === owner) setRefreshing(false);
    }
  };
  const save = async () => {
    if (!base || !canSave) return;
    const owner = session;
    setPending(true); setNotice(null);
    try {
      await owner.updateConversationContext({ conversationAnchorId: base.conversationAnchorId,
        expectedContextRevision: base.contextRevision, firstTurnSequence: first, omitSupplementalContext: omit });
      if (active.current !== owner) return;
      const observed = owner.getSnapshot();
      const selection = observed.state.conversationContext;
      if (observed.phase !== 'ready' || !selection || selection.conversationAnchorId !== base.conversationAnchorId
        || BigInt(selection.contextRevision) <= BigInt(base.contextRevision) || selection.firstTurnSequence !== first
        || selection.omitSupplementalContext !== omit) { setNotice('failed'); setConfirming(false); return; }
      setBase(null); setChoice('keep'); setConfirming(false); setNotice('saved');
    } catch (error) {
      if (active.current !== owner) return;
      const reason = asNimiError(error).reasonCode;
      setNotice(reason === 'AGENT_BUSY' || reason === 'agent-busy' ? 'busy'
        : reason === 'AGENT_CONVERSATION_CONTEXT_REVISION_CONFLICT' || reason === 'agent-conversation-context-revision-conflict' || reason === 'content-conflict' ? 'stale' : 'failed');
      setConfirming(false);
    } finally { if (active.current === owner) setPending(false); }
  };
  const refreshLabel = refreshing ? text('AgentCenter.conversationContext.refreshing') : text('AgentCenter.conversationContext.refresh');

  return <Card className="p-4">
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--nimi-radius-md)] bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]">
          <MessageCircle aria-hidden="true" className="h-4 w-4" />
        </span>
        <h3 className="m-0 min-w-0 text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
          {text('AgentCenter.conversationContext.title')}
        </h3>
      </div>
      {current && !base ? <Button size="sm" tone="ghost" onClick={begin} disabled={unavailable || current.busy || refreshing}>{text('AgentCenter.conversationContext.edit')}</Button> : null}
    </div>
    <p className="m-0 mt-3 text-[length:var(--nimi-type-caption-size)] leading-[1.55] text-[var(--nimi-text-secondary)]">
      {text(base ? 'AgentCenter.conversationContext.editDescription' : 'AgentCenter.conversationContext.description')}
    </p>
    {unavailable ? <div className="mt-3"><AgentCenterProductActionNotice
      action="updateConversationContext"
      availability={availability}
      i18n={i18n}
      onOpenRuntimeSettings={onOpenRuntimeSettings}
      session={session}
    /></div> : null}
    {current?.busy && notice !== 'busy' ? <InlineAlert tone="info" className="mt-3">{text('AgentCenter.conversationContext.busy')}</InlineAlert> : null}
    {notice ? <InlineAlert tone={notice === 'saved' || notice === 'refreshed' ? 'success' : 'warning'} className="mt-3">
      {text(`AgentCenter.conversationContext.${notice}`)}
    </InlineAlert> : null}
    {!current ? <div className="mt-3 text-sm">
      <p className="m-0 leading-[1.5] text-[var(--nimi-text-secondary)]">{text('AgentCenter.conversationContext.empty')}</p>
      <Button className="mt-3" leadingIcon={<RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />} tone="ghost" loading={refreshing} onClick={() => { void refresh(); }}>{refreshLabel}</Button>
    </div> : !base ? <>
      <dl className="m-0 mt-3 grid min-w-0 grid-cols-2 gap-3">
        <ContextStatusRow
          icon={<History aria-hidden="true" className="h-4 w-4" />}
          label={text('AgentCenter.conversationContext.historyLabel')}
          value={historyValue(current)}
        />
        <ContextStatusRow
          icon={<Database aria-hidden="true" className="h-4 w-4" />}
          label={text('AgentCenter.conversationContext.supplementLabel')}
          value={supplementalValue(current)}
        />
      </dl>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[var(--nimi-border-subtle)] pt-3">
        <p className="m-0 min-w-40 flex-1 text-[length:var(--nimi-type-caption-size)] leading-[1.5] text-[var(--nimi-text-secondary)]">
          {text('AgentCenter.conversationContext.sharedScope')}
        </p>
        <Button leadingIcon={<RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />} size="sm" tone="ghost" loading={refreshing} onClick={() => { void refresh(); }}>{refreshLabel}</Button>
      </div>
    </> : <div className="mt-4 grid min-w-0 gap-4">
      {stale && notice !== 'stale' ? <InlineAlert tone="warning">{text('AgentCenter.conversationContext.stale')}</InlineAlert> : null}
      {!confirming ? <>
        <fieldset className="m-0 min-w-0 border-0 p-0" disabled={controlsDisabled}>
          <legend className="p-0 text-sm font-semibold text-[var(--nimi-text-primary)]">{text('AgentCenter.conversationContext.selectLabel')}</legend>
          <p className="mb-0 mt-1 text-[length:var(--nimi-type-caption-size)] leading-[1.5] text-[var(--nimi-text-muted)]">{text('AgentCenter.conversationContext.historyHelp')}</p>
          <div className="mt-2.5 grid gap-2">
            {([
              { value: 'keep' as const, label: text('AgentCenter.conversationContext.keep'), description: historyValue(base) },
              ...(base.suggestedFirstTurnSequence !== null ? [{
                value: 'suggested' as const,
                label: text('AgentCenter.conversationContext.suggested', { count: base.suggestedFirstTurnSequence }),
                description: text('AgentCenter.conversationContext.suggestedHelp'),
              }] : []),
              {
                value: 'fresh' as const,
                label: text('AgentCenter.conversationContext.fresh', { count: base.committedTurnCount }),
                description: text('AgentCenter.conversationContext.freshHelp'),
              },
              { value: 'full' as const, label: text('AgentCenter.conversationContext.fullOption'), description: text('AgentCenter.conversationContext.fullOptionHelp') },
            ] satisfies readonly { value: HistoryChoice; label: string; description: string }[]).map((option) => {
              const selected = choice === option.value;
              return <label
                key={option.value}
                className={cnAgentCenter(
                  'flex min-w-0 cursor-pointer items-start gap-2.5 rounded-[12px] border px-3 py-2.5 transition-colors',
                  selected
                    ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-active)]'
                    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] hover:border-[var(--nimi-border-strong)]',
                  controlsDisabled && 'cursor-not-allowed opacity-[var(--nimi-opacity-disabled)]',
                )}
              >
                <input
                  type="radio"
                  name={historyGroupName}
                  value={option.value}
                  checked={selected}
                  onChange={() => { setChoice(option.value); setNotice(null); }}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--nimi-action-primary-bg)]"
                />
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-semibold leading-[1.4] text-[var(--nimi-text-primary)]">{option.label}</span>
                  <span className="text-[length:var(--nimi-type-caption-size)] leading-[1.45] text-[var(--nimi-text-secondary)]">{option.description}</span>
                </span>
              </label>;
            })}
          </div>
        </fieldset>
        <div className="flex items-start justify-between gap-4 rounded-[12px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold text-[var(--nimi-text-primary)]">{text('AgentCenter.conversationContext.includeLabel')}</p>
            <p className="mb-0 mt-1 text-[length:var(--nimi-type-caption-size)] leading-[1.5] text-[var(--nimi-text-secondary)]">{text('AgentCenter.conversationContext.includeHelp')}</p>
          </div>
          <Toggle
            ariaLabel={text('AgentCenter.conversationContext.includeLabel')}
            checked={!omit}
            disabled={controlsDisabled}
            onValueChange={(included) => { setOmit(!included); setNotice(null); }}
          />
        </div>
        <div className="grid gap-2 border-t border-[var(--nimi-border-subtle)] pt-3 text-[length:var(--nimi-type-caption-size)] leading-[1.5] text-[var(--nimi-text-muted)]">
          <p className="m-0">{text('AgentCenter.conversationContext.sourceLimit')}</p>
          <p className="m-0">{text('AgentCenter.conversationContext.sharedScope')}</p>
        </div>
      </> : <div className="grid min-w-0 gap-3">
        <h4 className="m-0 text-sm font-semibold text-[var(--nimi-text-primary)]">{text('AgentCenter.conversationContext.reviewTitle')}</h4>
        <dl className="m-0 overflow-hidden rounded-[12px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]">
          <ContextReviewRow
            label={text('AgentCenter.conversationContext.historyLabel')}
            before={historyValue(base)}
            after={nextSelection ? historyValue(nextSelection) : ''}
            changed={first !== base.firstTurnSequence}
            beforeLabel={text('AgentCenter.conversationContext.currentValue')}
            afterLabel={text('AgentCenter.conversationContext.nextValue')}
            unchangedLabel={text('AgentCenter.conversationContext.unchanged')}
          />
          <ContextReviewRow
            label={text('AgentCenter.conversationContext.supplementLabel')}
            before={supplementalValue(base)}
            after={nextSelection ? supplementalValue(nextSelection) : ''}
            changed={omit !== base.omitSupplementalContext}
            beforeLabel={text('AgentCenter.conversationContext.currentValue')}
            afterLabel={text('AgentCenter.conversationContext.nextValue')}
            unchangedLabel={text('AgentCenter.conversationContext.unchanged')}
          />
        </dl>
        {historyExpanded ? <InlineAlert tone="warning">{text('AgentCenter.conversationContext.restoreWarning')}</InlineAlert> : null}
        <div className="grid gap-2 text-[length:var(--nimi-type-caption-size)] leading-[1.5] text-[var(--nimi-text-secondary)]">
          <p className="m-0">{text('AgentCenter.conversationContext.sharedWarning')}</p>
          <p className="m-0">{text('AgentCenter.conversationContext.sourceLimit')}</p>
        </div>
      </div>}
      <div className="flex flex-wrap gap-2 border-t border-[var(--nimi-border-subtle)] pt-3">
        <Button loading={pending} disabled={!canSave} onClick={() => { if (confirming) void save(); else { setNotice(null); setConfirming(true); } }}>
          {pending ? text('AgentCenter.conversationContext.saving') : confirming ? text('AgentCenter.conversationContext.confirm') : text('AgentCenter.conversationContext.review')}
        </Button>
        {confirming ? <Button tone="secondary" disabled={pending || refreshing} onClick={() => setConfirming(false)}>{text('AgentCenter.conversationContext.back')}</Button> : null}
        <Button tone="ghost" disabled={pending || refreshing} onClick={cancel}>{text('AgentCenter.conversationContext.cancel')}</Button>
        {stale || notice === 'failed' || notice === 'stale' || notice === 'busy' || notice === 'refreshFailed'
          ? <Button tone="secondary" loading={refreshing} disabled={pending} onClick={() => { void refresh(); }}>{refreshLabel}</Button> : null}
      </div>
    </div>}
  </Card>;
}

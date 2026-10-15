import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert, SelectField, Toggle } from '@nimiplatform/kit/ui';
import { asNimiError } from '@nimiplatform/kit/core/sdk-contract';
import { translateAgentCenter } from '../i18n.js';
import { agentCenterEnCatalog } from '../locales/index.js';
import type { AgentCenterI18n, AgentCenterSession, AgentCenterSnapshot, AgentCenterState } from '../types.js';
import { Card } from './AgentCenterPrimitives.js';

type CopyKey = Extract<keyof typeof agentCenterEnCatalog, `AgentCenter.conversationContext.${string}`>;
type Selection = NonNullable<AgentCenterState['conversationContext']>;

// @nimi-authority: rule.nimi.runtime.agent-participation.conversation-context-selection
export function AgentCenterConversationContext({ session, snapshot, i18n }: {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
}) {
  const current = snapshot.state.conversationContext;
  const [base, setBase] = useState<Selection | null>(null);
  const [choice, setChoice] = useState('keep');
  const [omit, setOmit] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'failed' | 'busy' | 'stale' | null>(null);
  const active = useRef<AgentCenterSession | null>(session);
  active.current = session;
  useEffect(() => {
    setBase(null); setNotice(null); setPending(false); setConfirming(false);
    return () => { if (active.current === session) active.current = null; };
  }, [session]);
  const text = (key: CopyKey, values: Record<string, string> = {}) => translateAgentCenter(i18n, key, agentCenterEnCatalog[key], values);
  const unavailable = snapshot.availability.updateConversationContext.state !== 'available';
  const stale = base !== null && (base.contextRevision !== current?.contextRevision || base.conversationAnchorId !== current?.conversationAnchorId);
  const first = !base ? '0' : choice === 'fresh' ? base.committedTurnCount
    : choice === 'restore' ? '0' : choice === 'suggested' ? base.suggestedFirstTurnSequence ?? base.firstTurnSequence : base.firstTurnSequence;
  const nextOmit = choice === 'restore' ? false : omit;
  const changed = base !== null && (first !== base.firstTurnSequence || nextOmit !== base.omitSupplementalContext);
  const canSave = changed && !pending && !stale && !current?.busy && !unavailable;
  const begin = () => {
    if (!current) return;
    setBase(current); setChoice('keep'); setOmit(current.omitSupplementalContext); setConfirming(false); setNotice(null);
  };
  const refresh = async () => {
    const owner = session;
    await owner.refresh();
    if (active.current !== owner) return;
    if (owner.getSnapshot().phase !== 'ready') { setNotice('failed'); return; }
    setBase(null); setConfirming(false); setNotice(null);
  };
  const save = async () => {
    if (!base || !canSave) return;
    const owner = session;
    setPending(true); setNotice(null);
    try {
      await owner.updateConversationContext({ conversationAnchorId: base.conversationAnchorId,
        expectedContextRevision: base.contextRevision, firstTurnSequence: first, omitSupplementalContext: nextOmit });
      if (active.current !== owner) return;
      const observed = owner.getSnapshot();
      const selection = observed.state.conversationContext;
      if (observed.phase !== 'ready' || !selection || selection.conversationAnchorId !== base.conversationAnchorId
        || BigInt(selection.contextRevision) <= BigInt(base.contextRevision) || selection.firstTurnSequence !== first
        || selection.omitSupplementalContext !== nextOmit) { setNotice('failed'); setConfirming(false); return; }
      setBase(null); setConfirming(false); setNotice('saved');
    } catch (error) {
      if (active.current !== owner) return;
      const reason = asNimiError(error).reasonCode;
      setNotice(reason === 'AGENT_BUSY' || reason === 'agent-busy' ? 'busy'
        : reason === 'AGENT_CONVERSATION_CONTEXT_REVISION_CONFLICT' || reason === 'agent-conversation-context-revision-conflict' || reason === 'content-conflict' ? 'stale' : 'failed');
      setConfirming(false);
    } finally { if (active.current === owner) setPending(false); }
  };

  return <Card className="p-4">
    <h3 className="m-0 text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
      {text('AgentCenter.conversationContext.title')}
    </h3>
    <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{text('AgentCenter.conversationContext.description')}</p>
    <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{text('AgentCenter.conversationContext.sourceLimit')}</p>
    {!current ? <div className="mt-3 text-sm"><p>{text('AgentCenter.conversationContext.empty')}</p>
      <Button className="mt-2" tone="ghost" onClick={() => { void refresh(); }}>{text('AgentCenter.conversationContext.refresh')}</Button>
    </div> : <>
      <p className="mt-3 text-sm">{current.firstTurnSequence === '0' ? text('AgentCenter.conversationContext.full')
        : text('AgentCenter.conversationContext.range', { count: current.firstTurnSequence })}</p>
      {current.omitSupplementalContext ? <p className="mt-1 text-sm">{text('AgentCenter.conversationContext.omitted')}</p> : null}
      {current.busy ? <InlineAlert tone="info" className="mt-3">{text('AgentCenter.conversationContext.busy')}</InlineAlert> : null}
      {notice ? <InlineAlert tone={notice === 'saved' ? 'info' : 'warning'} className="mt-3">
        {text(`AgentCenter.conversationContext.${notice}`)}
      </InlineAlert> : null}
      {!base ? <div className="mt-3 flex flex-wrap gap-2">
        <Button tone="secondary" onClick={begin} disabled={unavailable || current.busy}>{text('AgentCenter.conversationContext.edit')}</Button>
        <Button tone="ghost" onClick={() => { void refresh(); }}>{text('AgentCenter.conversationContext.refresh')}</Button>
      </div> : <div className="mt-4 grid min-w-0 gap-3">
        {stale ? <InlineAlert tone="warning">{text('AgentCenter.conversationContext.stale')}</InlineAlert> : null}
        {!confirming ? <>
          <label className="grid gap-2 text-sm">
            {text('AgentCenter.conversationContext.selectLabel')}
            <SelectField value={choice} disabled={pending || stale} aria-label={text('AgentCenter.conversationContext.selectLabel')}
              onValueChange={setChoice} options={[
                { value: 'keep', label: text('AgentCenter.conversationContext.keep') },
                ...(base.suggestedFirstTurnSequence !== null ? [{ value: 'suggested', label: text('AgentCenter.conversationContext.suggested', { count: base.suggestedFirstTurnSequence }) }] : []),
                { value: 'fresh', label: text('AgentCenter.conversationContext.fresh', { count: base.committedTurnCount }) },
                { value: 'restore', label: text('AgentCenter.conversationContext.restore') },
              ]} />
          </label>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 text-sm"><p>{text('AgentCenter.conversationContext.omitLabel')}</p>
              <p className="mt-1 text-[var(--nimi-text-secondary)]">{text('AgentCenter.conversationContext.omitHelp')}</p></div>
            <Toggle ariaLabel={text('AgentCenter.conversationContext.omitLabel')} checked={nextOmit} disabled={pending || stale || choice === 'restore'} onChange={setOmit} />
          </div>
        </> : <InlineAlert tone="warning">
          <p>{first === '0' ? text('AgentCenter.conversationContext.restoreWarning') : text('AgentCenter.conversationContext.range', { count: first })}</p>
          {nextOmit ? <p className="mt-2">{text('AgentCenter.conversationContext.omitHelp')}</p> : null}
          <p className="mt-2">{text('AgentCenter.conversationContext.sharedWarning')}</p>
        </InlineAlert>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canSave} onClick={() => { if (confirming) void save(); else setConfirming(true); }}>
            {pending ? text('AgentCenter.conversationContext.saving') : confirming ? text('AgentCenter.conversationContext.confirm') : text('AgentCenter.conversationContext.review')}
          </Button>
          <Button tone="ghost" disabled={pending} onClick={() => { setBase(null); setConfirming(false); }}>{text('AgentCenter.conversationContext.cancel')}</Button>
          {stale || notice === 'failed' || notice === 'stale' ? <Button tone="secondary" disabled={pending} onClick={() => { void refresh(); }}>{text('AgentCenter.conversationContext.refresh')}</Button> : null}
        </div>
      </div>}
    </>}
  </Card>;
}

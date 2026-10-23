import { useRef } from 'react';
import { Button, nimiToast } from '@nimiplatform/kit/ui';
import type { LifeItem } from '../domain/types.js';
import { useDesk, useNimiDay } from '../app/context.js';
import { saveFailureMessage } from './save-feedback.js';

/** The same decision controls are available from the list and a linked question. */
// @nimi-authority: definition.nimi.nimiday.assistant.business
export function ItemDecision({ item, onFollowUp }: { readonly item: LifeItem; readonly onFollowUp?: () => void }) {
  const { actions, copy, engine, navigate, store } = useNimiDay();
  const desk = useDesk();
  const followingUp = useRef(false);
  const agent = desk.phase === 'ready' ? desk.agent : null;
  const followUp = async (choice: string) => {
    const current = store.getSnapshot().state.items.find(entry => entry.id === item.id);
    if (!agent || followingUp.current || current?.state !== 'done' || current.decision?.choice !== choice) return;
    followingUp.current = true;
    try {
      const saved = await store.persist();
      if (!saved.ok) {
        nimiToast.show({ tone: 'warning', message: saveFailureMessage(copy, store.getSnapshot()), durationMs: 5000 });
        return;
      }
      const latest = store.getSnapshot().state.items.find(entry => entry.id === item.id);
      if (latest?.state !== 'done' || latest.decision?.choice !== choice
        || latest.decision.question !== current.decision.question) return;
      const result = await engine.chat(copy.item.decisionFollowUp(current.decision.question, choice));
      if (result.ok) {
        onFollowUp?.();
        navigate({ view: 'assistant' });
      } else nimiToast.show({ tone: 'warning', message: result.reason === 'busy' ? copy.assistant.busy(agent.displayName) : copy.assistant.sendFailed, durationMs: 5000 });
    } finally {
      followingUp.current = false;
    }
  };
  if (!item.decision) return null;
  return <>
    {item.state === 'waiting' ? <div className="nd-inline-actions nd-decision-options" style={{ marginTop: 8 }}>
      {item.decision.options.map(option => <Button key={option} size="sm" tone="secondary" onClick={async () => {
        actions.decide(item.id, option);
        const saved = await store.persist();
        if (!saved.ok) {
          nimiToast.show({ tone: 'warning', message: saveFailureMessage(copy, store.getSnapshot()), durationMs: 5000 });
          return;
        }
        nimiToast.show({
          tone: 'success', message: copy.item.decidedToast(option), durationMs: 8000,
          ...(agent && item.origin.by === 'agent' ? { action: { label: copy.item.decisionFollowUpAction(agent.displayName), onClick: () => { void followUp(option); } } } : {}),
        });
      }}>{option}</Button>)}
    </div> : null}
    {item.decision.choice ? <div className="nd-decision-result">
      <div className="nd-faint">{copy.item.decided(item.decision.choice)}</div>
      {agent && item.origin.by === 'agent' && item.state === 'done' ? <Button size="sm" tone="secondary" onClick={() => { void followUp(item.decision!.choice!); }}>{copy.item.decisionFollowUpAction(agent.displayName)}</Button> : null}
    </div> : null}
    {item.state === 'done' || item.state === 'dropped' ? <Button size="sm" tone="ghost" onClick={() => {
      actions.reopenItem(item.id);
      nimiToast.show({ tone: 'info', message: copy.item.reconsidered, durationMs: 6000 });
    }}>{copy.item.reconsider}</Button> : null}
  </>;
}

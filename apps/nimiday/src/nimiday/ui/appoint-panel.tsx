import { useState } from 'react';
import { Button, InlineAlert, nimiToast } from '@nimiplatform/kit/ui';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import { useDayStore, useDesk, useNimiDay } from '../app/context.js';
import { AgentAvatar } from './common.js';

/**
 * Choose who serves in the NimiDay post. The list is the current account's
 * active LocalAgents; a previous appointment is highlighted, never assumed.
 */
export function AppointPanel({ onDone, compact = false }: { readonly onDone?: () => void; readonly compact?: boolean }) {
  const { desk: deskApi, engine, actions, copy } = useNimiDay();
  const desk = useDesk();
  const { state } = useDayStore();
  const [selected, setSelected] = useState<string | null>(() => (
    desk.references.length === 1 ? desk.references[0]!.agentHandle : null
  ));
  const [busy, setBusy] = useState(false);
  const chosen = desk.references.find((reference) => reference.agentHandle === selected) ?? null;

  const appoint = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      // Handing the post to someone else ends NimiDay's in-flight request with
      // the current agent first; nothing queued starts until the new agent is in.
      const stopCurrent = desk.agent !== null && desk.agent.binding !== chosen.binding;
      const agent = await engine.handOver(() => deskApi.appoint(chosen.agentHandle), { stopCurrent });
      if (!agent) return;
      actions.appoint({
        displayName: agent.displayName,
        avatarUrl: agent.avatarUrl,
        binding: agent.binding,
        appointedAt: new Date().toISOString(),
      });
      onDone?.();
    } finally {
      setBusy(false);
    }
  };

  const findPartner = async () => {
    try {
      const result = await openDesktopIntent({ intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' } });
      if (result.status !== 'accepted') nimiToast.show({ tone: 'warning', message: copy.agent.openHomeFailed, durationMs: 5000 });
    } catch {
      nimiToast.show({ tone: 'warning', message: copy.agent.openHomeFailed, durationMs: 5000 });
    }
  };

  if (desk.phase === 'loading' || desk.phase === 'idle' || desk.phase === 'opening') {
    return <p className="nd-empty">{copy.agent.connecting}</p>;
  }

  if (desk.phase === 'unavailable') {
    return (
      <InlineAlert tone="warning" action={<Button size="sm" tone="secondary" onClick={() => { void deskApi.start(state.profile.appointment); }}>{copy.common.retry}</Button>}>
        {desk.unreachable ? copy.agent.unreachableBody(desk.unreachable.displayName) : copy.agent.unavailable}
        {desk.error ? <details className="nd-faint"><summary>{copy.assistant.technical}</summary>{desk.error}</details> : null}
      </InlineAlert>
    );
  }

  if (desk.phase === 'no-agents') {
    return (
      <div data-testid="nd-no-agents">
        <p style={{ margin: 0, fontWeight: 600 }}>{copy.agent.noAgents}</p>
        <p className="nd-muted" style={{ margin: '6px 0 12px', fontSize: 13 }}>{copy.agent.noAgentsBody}</p>
        <div className="nd-inline-actions">
          <Button tone="primary" size="sm" onClick={() => { void findPartner(); }}>{copy.agent.findPartner}</Button>
          <Button tone="ghost" size="sm" onClick={() => { void deskApi.start(state.profile.appointment); }}>{copy.common.retry}</Button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="nd-appoint-panel">
      {desk.awaitingConfirmation ? (
        <div style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: 14 }}>{copy.agent.confirmTitle(desk.awaitingConfirmation.displayName)}</strong>
          <p className="nd-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{copy.agent.confirmBody}</p>
        </div>
      ) : null}
      {!compact ? (
        <p className="nd-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
          {chosen ? copy.onboarding.chooseBody(chosen.displayName) : copy.onboarding.chooseGeneric}
        </p>
      ) : null}
      <div className="nd-agent-options">
        {desk.references.map((reference) => (
          <button
            key={reference.agentHandle}
            type="button"
            className="nd-agent-option"
            aria-pressed={selected === reference.agentHandle}
            onClick={() => setSelected(reference.agentHandle)}
            data-testid="nd-agent-option"
          >
            <AgentAvatar name={reference.displayName} url={reference.avatarUrl} size="lg" />
            <span>{reference.displayName}</span>
            {desk.phase === 'ready' && desk.agent?.binding === reference.binding
              ? <small className="nd-agent-option-note">{copy.agent.currentlyOnDuty}</small>
              : null}
          </button>
        ))}
      </div>
      {desk.error ? <details className="nd-faint"><summary>{copy.agent.appointFailed}</summary>{desk.error}</details> : null}
      <Button tone="primary" size="md" disabled={!chosen} loading={busy} onClick={() => { void appoint(); }}>
        {chosen ? copy.onboarding.appointCta(chosen.displayName) : copy.agent.appoint}
      </Button>
    </div>
  );
}

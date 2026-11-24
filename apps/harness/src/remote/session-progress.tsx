import { useEffect, useState } from 'react';
import type { NimiAppScope } from '@nimiplatform/kit/auth/app';
import { Button } from '@nimiplatform/kit/ui';
import { Loader2, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n.js';

const stageKeys = ['idle', 'queued', 'placed', 'generating', 'waiting', 'tools', 'done', 'unanswered'] as const;
export type ProgressStage = (typeof stageKeys)[number];

export type ProgressView = {
  stage: ProgressStage;
  turn: number;
  text: string;
  truncated: boolean;
  activeTool?: string;
  hasPendingDecision?: boolean;
};

function parseView(json: string): ProgressView {
  const value = JSON.parse(json);
  if (!value || !stageKeys.includes(value.stage) || !Number.isSafeInteger(value.turn) || value.turn < 0
    || typeof value.text !== 'string' || [...value.text].length > 8192 || typeof value.truncated !== 'boolean') {
    throw new Error('The PC returned an invalid progress snapshot.');
  }
  return {
    stage: value.stage,
    turn: value.turn,
    text: value.text,
    truncated: value.truncated,
    ...(typeof value.activeTool === 'string' && value.activeTool ? { activeTool: value.activeTool } : {}),
    ...(typeof value.hasPendingDecision === 'boolean' ? { hasPendingDecision: value.hasPendingDecision } : {}),
  };
}

export function useSessionProgress(scope: NimiAppScope, target: string, sessionId: string, enabled: boolean) {
  const [view, setView] = useState<ProgressView>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setView(undefined);
      setError('');
      return;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, scope.signal]);
    setView(undefined);
    setError('');
    async function observe() {
      const subscribe = scope.client.integration.subscribeSnapshots;
      if (!subscribe) throw new Error('This Runtime connection does not support live progress.');
      const stream = subscribe({ targetRef: target, operation: 'session.observeProgress', inputJson: JSON.stringify({ sessionId }) }, { signal });
      for await (const snapshot of stream) {
        if (signal.aborted) return;
        setView(parseView(snapshot.resultJson));
      }
      if (!signal.aborted) throw new Error('The PC ended this observation.');
    }
    void observe().catch(cause => { if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [scope, target, sessionId, enabled, attempt]);

  return { view, error, reconnect: () => setAttempt(x => x + 1) };
}

export function SessionProgressBadge({
  view,
  error,
  onReconnect,
}: {
  view?: ProgressView;
  error: string;
  onReconnect: () => void;
}) {
  const { t } = useI18n();
  if (error) {
    return (
      <div className="harness-remote-status harness-remote-status--error">
        <span role="alert">{error}</span>
        <Button size="sm" tone="ghost" leadingIcon={<RefreshCw size={12} />} onClick={onReconnect}>
          {t('remote.reconnect')}
        </Button>
      </div>
    );
  }
  const stage = view?.stage;
  const active = stage === 'generating' || stage === 'tools' || stage === 'queued' || stage === 'placed';
  const tone = stage === 'waiting' ? 'warning' : active ? 'info' : stage === 'unanswered' ? 'danger' : 'neutral';
  const label = stage
    ? (stage === 'tools' && view.activeTool ? `${t('remote.stage.tools')}: ${view.activeTool}` : t(`remote.stage.${stage}` as const))
    : t('remote.connectingProgress');

  return (
    <span className={`harness-pill harness-pill--${tone}`} role="status">
      {active && <Loader2 size={12} className="harness-spin" aria-hidden="true" />}
      <span>{label}</span>
    </span>
  );
}

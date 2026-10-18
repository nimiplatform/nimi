import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Toggle } from '@nimiplatform/kit/ui';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
  NimiLocalAppConversationState,
} from '@nimiplatform/sdk/app';

export function AgentFollowUpControl(props: {
  agentHandle: string;
  conversationAnchorId: string;
  state: NimiLocalAppConversationState | null;
  conversation: () => NimiLocalAppConversationClient;
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [due, setDue] = useState('');
  const state = props.state;
  const scope = {
    agentHandle: props.agentHandle as NimiLocalAppAgentHandle,
    conversationAnchorId: props.conversationAnchorId,
  };
  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(false);
    try {
      await operation();
      if (alive.current) props.refresh();
    } catch (error) {
      logRendererEvent({
        level: 'warn',
        area: 'agent-chat',
        message: 'action:follow-up-control-failed',
        details: { ...extractNimiErrorFields(error) },
      });
      if (alive.current) {
        setError(true);
        props.refresh();
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const task = state?.pendingFollowUp;
  const scheduled = task ? new Date(Number(task.scheduledFor.seconds) * 1000).toLocaleString() : '';
  const newDue = Date.parse(due);
  return (
    <details className="mx-3 my-2 text-xs text-neutral-600">
      <summary className="cursor-pointer">{t('Chat.followUpTitle')}</summary>
      <div className="grid gap-2 py-2">
        <p>{t('Chat.followUpDescription')}</p>
        {state ? (
          <>
            <label className="flex items-center gap-2">
              <Toggle
                checked={state.followUpEnabled}
                disabled={busy}
                ariaLabel={t('Chat.followUpEnabled')}
                onChange={(enabled) => {
                  void act(() =>
                    props.conversation().setFollowUpPolicy({
                      ...scope,
                      expectedRevision: state.followUpPolicyRevision,
                      enabled,
                    }),
                  );
                }}
              />
              <span>{t('Chat.followUpEnabled')}</span>
            </label>
            <p>{t('Chat.followUpLimit', { count: state.maxFollowUpTurns })}</p>
            {task ? (
              <>
                <p>{t('Chat.followUpPending', { time: scheduled })}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    tone="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void act(() =>
                        props.conversation().updateFollowUp({
                          ...scope,
                          taskId: task.taskId,
                          expectedRevision: task.revision,
                          action: 'cancel',
                        }),
                      );
                    }}
                  >
                    {t('Chat.followUpCancel')}
                  </Button>
                  <input
                    aria-label={t('Chat.followUpNewTime')}
                    type="datetime-local"
                    value={due}
                    onChange={(event) => setDue(event.currentTarget.value)}
                    disabled={busy}
                    className="rounded border p-1"
                  />
                  <Button
                    tone="ghost"
                    size="sm"
                    disabled={busy || !Number.isFinite(newDue) || newDue <= Date.now()}
                    onClick={() => {
                      void act(() =>
                        props.conversation().updateFollowUp({
                          ...scope,
                          taskId: task.taskId,
                          expectedRevision: task.revision,
                          action: 'reschedule',
                          scheduledFor: { seconds: String(Math.floor(newDue / 1000)), nanos: 0 },
                        }),
                      );
                    }}
                  >
                    {t('Chat.followUpReschedule')}
                  </Button>
                </div>
              </>
            ) : (
              <p>{t('Chat.followUpNone')}</p>
            )}
            <p>{t('Chat.followUpStartedNotice')}</p>
          </>
        ) : (
          <p>{t('Chat.followUpUnavailable')}</p>
        )}
        {error ? <p role="alert">{t('Chat.followUpChanged')}</p> : null}
        {!state || error ? (
          <Button tone="ghost" size="sm" onClick={props.refresh}>
            {t('Chat.followUpRefresh')}
          </Button>
        ) : null}
      </div>
    </details>
  );
}

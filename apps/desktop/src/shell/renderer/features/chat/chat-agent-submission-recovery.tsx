import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
} from '@nimiplatform/sdk/app';
import { Button } from '@nimiplatform/kit/ui';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { chatRuntimeReasonCodeMessage, localAgentConfigurationFailure } from './chat-runtime-error-message.js';
import type { AgentPendingSubmission } from './chat-agent-composer-persistence.js';

// @nimi-authority: rule.nimi.desktop.agent-projection.composer-draft
export async function reconcileAgentSubmission(input: {
  conversation: NimiLocalAppConversationClient;
  agentHandle: NimiLocalAppAgentHandle;
  submission: AgentPendingSubmission;
  sendIfMissing: boolean;
  isCurrent: () => boolean;
}): Promise<boolean> {
  const { submission, conversation, agentHandle } = input;
  const scope = { agentHandle, conversationAnchorId: submission.conversationAnchorId };
  if (!input.isCurrent()) return false;
  if (!input.sendIfMissing) {
    const snapshot = await conversation.snapshot(scope);
    // Snapshot history may be bounded. Absence never proves non-admission.
    return input.isCurrent() && snapshot.turns.some((turn) => turn.requestId === submission.requestId);
  }
  // The same request ID lets Runtime return its admitted turn or accept this
  // original request once. A separate snapshot is not a prerequisite.
  await conversation.send(
    submission.retryOfTurnId
      ? { ...scope, requestId: submission.requestId, retryOfTurnId: submission.retryOfTurnId }
      : {
          ...scope,
          requestId: submission.requestId,
          parts: [
            ...(submission.text ? [{ kind: 'text' as const, text: submission.text }] : []),
            ...submission.artifactIds.map((artifactId) => ({
              kind: 'artifact-ref' as const,
              artifactId,
            })),
          ],
        },
  );
  return input.isCurrent();
}

export function AgentSubmissionRecovery(props: {
  submission: AgentPendingSubmission;
  agentHandle: string;
  conversation: () => NimiLocalAppConversationClient;
  acknowledge: (requestId: string) => Promise<void>;
  onResolved: () => void;
  onRestore: (text: string) => void;
  onOpenAgentCenter?: () => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'checking' | 'unknown' | 'error'>('idle');
  const [reasonCode, setReasonCode] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const check = async (sendIfMissing: boolean) => {
    setState('checking');
    setReasonCode('');
    try {
      const resolved = await reconcileAgentSubmission({
        conversation: props.conversation(),
        agentHandle: props.agentHandle as NimiLocalAppAgentHandle,
        submission: props.submission,
        sendIfMissing,
        isCurrent: () => active.current,
      });
      if (!active.current) return;
      if (resolved) {
        await props.acknowledge(props.submission.requestId);
        if (active.current) props.onResolved();
      } else setState('unknown');
    } catch (error) {
      if (active.current) {
        setReasonCode(extractNimiErrorFields(error).reasonCode || '');
        setState('error');
      }
    }
  };
  return (
    <div role="status" className="m-2 rounded border border-neutral-200 p-3 text-sm">
      <p>{t('Chat.agentSubmissionPending')}</p>
      <p>{t('Chat.agentSubmissionRecoverNotice')}</p>
      {props.submission.text ? (
        <p className="my-2 max-h-32 overflow-auto whitespace-pre-wrap break-words">{props.submission.text}</p>
      ) : null}
      {props.submission.artifactIds.length ? (
        <p>
          {t('Chat.agentSubmissionAttachments', { count: props.submission.artifactIds.length })}
        </p>
      ) : null}
      {state === 'unknown' ? <p>{t('Chat.agentSubmissionUnknown')}</p> : null}
      {state === 'error' ? <p role="alert">{chatRuntimeReasonCodeMessage(reasonCode, t, { localAgent: true }) || t('Chat.agentSubmissionCheckFailed')}</p> : null}
      {state === 'error' && reasonCode ? <details className="text-xs"><summary>{t('Feedback.technicalDetails')}</summary><code>{reasonCode}</code></details> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {state === 'error' && localAgentConfigurationFailure(reasonCode) && props.onOpenAgentCenter ? <Button tone="ghost" size="sm" onClick={props.onOpenAgentCenter}>{t('Chat.agentOpenConfiguration')}</Button> : null}
        <Button
          tone="ghost"
          size="sm"
          disabled={state === 'checking'}
          onClick={() => {
            void check(true);
          }}
        >
          {t('Chat.agentSubmissionRecover')}
        </Button>
          <Button
            tone="ghost"
            size="sm"
            onClick={() => {
              void check(false);
            }}
            disabled={state === 'checking'}
          >
            {t('Chat.agentSubmissionCheck')}
          </Button>
        <Button
          tone="ghost"
          size="sm"
          disabled={state === 'checking'}
          onClick={() => {
            props.onRestore(props.submission.text);
            void props.acknowledge(props.submission.requestId).catch(() => {
              if (active.current) setState('error');
            });
          }}
        >
          {t('Chat.agentSubmissionKeepAsDraft')}
        </Button>
      </div>
      <p className="mt-1 text-xs text-neutral-500">{t('Chat.agentSubmissionDraftNotice')}</p>
    </div>
  );
}

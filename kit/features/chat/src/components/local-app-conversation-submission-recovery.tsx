import { reconcileAgentSubmission } from '@nimiplatform/kit/features/chat/headless';
import React, { useEffect, useRef, useState } from 'react';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
} from '@nimiplatform/kit/core/sdk-contract';
import { Button } from '@nimiplatform/kit/ui';
import { extractNimiErrorFields } from '@nimiplatform/kit/core/sdk-contract';
import type { AgentPendingSubmission } from '@nimiplatform/kit/features/chat/headless';

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-061
export function LocalAppConversationSubmissionRecovery(props: {
  translate: (key: string, values?: Record<string, string | number>) => string;
  describeError?: (reasonCode: string) => string | null;
  isConfigurationError?: (reasonCode: string) => boolean;
  submission: AgentPendingSubmission;
  agentHandle: string;
  conversation: () => NimiLocalAppConversationClient;
  acknowledge: (requestId: string) => Promise<void>;
  /** Owner cleanup for confirmed admission, before the saved copy disappears. */
  onAdmitted?: (submission: AgentPendingSubmission) => void;
  onResolved: () => void;
  onRestore: (text: string) => void;
  onOpenAgentCenter?: () => void;
}) {
  const t = props.translate;
  const identity = `${props.agentHandle}|${props.submission.conversationAnchorId}|${props.submission.requestId}`;
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const [state, setState] = useState<'idle' | 'checking' | 'unknown' | 'error'>('idle');
  const [reasonCode, setReasonCode] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    setState('idle');
    setReasonCode('');
    return () => {
      active.current = false;
    };
  }, [identity]);
  const check = async (sendIfMissing: boolean) => {
    const current = () => active.current && latestIdentity.current === identity;
    setState('checking');
    setReasonCode('');
    try {
      const resolved = await reconcileAgentSubmission({
        conversation: props.conversation(),
        agentHandle: props.agentHandle as NimiLocalAppAgentHandle,
        submission: props.submission,
        sendIfMissing,
        isCurrent: current,
      });
      if (!current()) return;
      if (resolved) {
        props.onAdmitted?.(props.submission);
        await props.acknowledge(props.submission.requestId);
        if (current()) props.onResolved();
      } else setState('unknown');
    } catch (error) {
      if (current()) {
        setReasonCode(extractNimiErrorFields(error).reasonCode || '');
        setState('error');
      }
    }
  };
  return (
    <div role="status" className="m-2 rounded border border-neutral-200 p-3 text-sm">
      <p>{t(props.submission.retryOfTurnId ? 'Chat.agentSubmissionRetryPending' : 'Chat.agentSubmissionPending')}</p>
      <p>{t('Chat.agentSubmissionRecoverNotice')}</p>
      {props.submission.text ? (
        <p className="my-2 max-h-32 overflow-auto whitespace-pre-wrap break-words">{props.submission.text}</p>
      ) : null}
      {props.submission.artifactIds.length ? (
        <p>
          {t('Chat.agentSubmissionAttachments', { count: props.submission.artifactIds.length })}
        </p>
      ) : null}
      {props.submission.quote ? <p>{t('Chat.agentSubmissionQuoteRetained')}</p> : null}
      {state === 'unknown' ? <p>{t('Chat.agentSubmissionUnknown')}</p> : null}
      {state === 'error' ? <p role="alert">{props.describeError?.(reasonCode) || t('Chat.agentSubmissionCheckFailed')}</p> : null}
      {state === 'error' && reasonCode ? <details className="text-xs"><summary>{t('Feedback.technicalDetails')}</summary><code>{reasonCode}</code></details> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {state === 'error' && props.isConfigurationError?.(reasonCode) && props.onOpenAgentCenter ? <Button tone="ghost" size="sm" onClick={props.onOpenAgentCenter}>{t('Chat.agentOpenConfiguration')}</Button> : null}
        <Button
          tone="primary"
          size="sm"
          disabled={state === 'checking'}
          onClick={() => {
            void check(true);
          }}
        >
          {t(state === 'checking' ? 'Chat.agentSubmissionWorking'
            : props.submission.retryOfTurnId ? 'Chat.agentSubmissionRetryRecover' : 'Chat.agentSubmissionRecover')}
        </Button>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-neutral-600">{t('Chat.agentSubmissionOtherOptions')}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
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
                if (active.current && latestIdentity.current === identity) setState('error');
              });
            }}
          >
            {t(props.submission.text ? 'Chat.agentSubmissionKeepAsDraft' : 'Chat.agentSubmissionDismiss')}
          </Button>
        </div>
        <p className="mt-1 text-xs text-neutral-500">{t('Chat.agentSubmissionDraftNotice')}</p>
      </details>
    </div>
  );
}

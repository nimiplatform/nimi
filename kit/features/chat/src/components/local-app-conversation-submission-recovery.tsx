import { reconcileAgentSubmission } from '@nimiplatform/kit/features/chat/headless';
import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Clock3 } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    setState('idle');
    setReasonCode('');
    setExpanded(false);
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
  const busy = state === 'checking';
  const title = busy ? t('Chat.agentSubmissionWorking') : state === 'unknown' ? t('Chat.agentSubmissionUnknown')
    : t(props.submission.retryOfTurnId ? 'Chat.agentSubmissionRetryPending' : 'Chat.agentSubmissionPending');
  return (
    <div className="px-2 py-1 text-sm text-[var(--nimi-text-secondary)]">
      <div className="flex flex-wrap items-center gap-x-2">
        <Clock3 aria-hidden="true" size={15} className="shrink-0" />
        <span role="status" className="mr-auto">{title}</span>
        <Button tone="ghost" size="sm" className="text-[var(--nimi-action-primary-bg)]" disabled={busy} onClick={() => void check(false)}>
          {t('Chat.agentSubmissionCheck')}
        </Button>
        <Button tone="ghost" size="sm" aria-expanded={expanded} aria-controls={detailsId}
          trailingIcon={<ChevronDown size={14} className={expanded ? 'rotate-180' : undefined} />}
          onClick={() => setExpanded(open => !open)}>
          {t('Chat.agentSubmissionOtherOptions')}
        </Button>
      </div>
      {state === 'error' ? <div className="mt-1 flex flex-wrap items-center gap-2">
        <span role="alert">{props.describeError?.(reasonCode) || t('Chat.agentSubmissionCheckFailed')}</span>
        {props.isConfigurationError?.(reasonCode) && props.onOpenAgentCenter ? <Button tone="ghost" size="sm" onClick={props.onOpenAgentCenter}>{t('Chat.agentOpenConfiguration')}</Button> : null}
      </div> : null}
      <div id={detailsId} hidden={!expanded} className="my-1 border-l border-[var(--nimi-border-subtle)] pl-4">
        {props.submission.text ? <blockquote className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-[var(--nimi-text-primary)]">{props.submission.text}</blockquote> : null}
        {props.submission.artifactIds.length ? <p>{t('Chat.agentSubmissionAttachments', { count: props.submission.artifactIds.length })}</p> : null}
        {props.submission.quote ? <p>{t('Chat.agentSubmissionQuoteRetained')}</p> : null}
        <p id={`${detailsId}-cost`} className="mt-2 text-xs">{t('Chat.agentSubmissionRecoverNotice')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Button tone="secondary" size="sm" disabled={busy} aria-describedby={`${detailsId}-cost`} onClick={() => void check(true)}>
            {t(props.submission.retryOfTurnId ? 'Chat.agentSubmissionRetryRecover' : 'Chat.agentSubmissionRecover')}
          </Button>
          <Button
            tone="ghost"
            size="sm"
            disabled={busy}
            aria-describedby={`${detailsId}-draft`}
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
        <p id={`${detailsId}-draft`} className="mt-1 text-xs">{t('Chat.agentSubmissionDraftNotice')}</p>
        {state === 'error' && reasonCode ? <details className="mt-2 text-xs"><summary>{t('Feedback.technicalDetails')}</summary><code>{reasonCode}</code></details> : null}
      </div>
    </div>
  );
}

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { asNimiError } from '@nimiplatform/sdk/types';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { type InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { toErrorMessage } from './chat-agent-shell-core';
import { toChatUserFacingRuntimeError } from './chat-runtime-error-message.js';

export type AgentConversationHostErrorDetails = {
  error: string;
  action?: string;
  reasonCode?: string;
  actionHint?: string;
  causeMessage?: string;
} & Record<string, unknown>;

export type ReportAgentConversationHostError = (
  error: unknown,
  options?: { action?: string; extra?: Record<string, unknown> },
) => void;

export function useAgentConversationHostFeedback() {
  const { t } = useTranslation();
  const [hostFeedback, setHostFeedback] = useState<InlineFeedbackState | null>(null);
  const buildHostErrorDetails = useCallback((
    error: unknown,
    action?: string,
    extra?: Record<string, unknown>,
  ): AgentConversationHostErrorDetails => {
    const normalized = asNimiError(error, { source: 'runtime' });
    const causeMessage = error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : undefined;
    return {
      error: toErrorMessage(error),
      ...(action ? { action } : {}),
      ...(typeof normalized.reasonCode === 'string' && normalized.reasonCode.trim()
        ? { reasonCode: normalized.reasonCode.trim() }
        : {}),
      ...(typeof normalized.actionHint === 'string' && normalized.actionHint.trim()
        ? { actionHint: normalized.actionHint.trim() }
        : {}),
      ...(causeMessage ? { causeMessage } : {}),
      ...(extra || {}),
    };
  }, []);
  const reportHostError = useCallback<ReportAgentConversationHostError>((error, options) => {
    const details = buildHostErrorDetails(error, options?.action, options?.extra);
    const message = toChatUserFacingRuntimeError(error, 'Agent response failed', t).message;
    logRendererEvent({
      level: 'error',
      area: 'agent-chat-shell',
      message: 'action:host-error',
      details,
    });
    setHostFeedback({
      kind: 'error',
      message,
    });
  }, [buildHostErrorDetails, t]);

  return {
    buildHostErrorDetails,
    hostFeedback,
    reportHostError,
    setHostFeedback,
  };
}

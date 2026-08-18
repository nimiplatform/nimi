import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { asNimiError } from '@nimiplatform/sdk/types';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { type InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { toErrorMessage } from './chat-agent-shell-core';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import {
  chatContextCapacityFailureMessage,
  projectChatContextCapacityFailure,
} from './chat-runtime-error-message.js';

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
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const setActiveTab = useAppStore((state) => state.setActiveTab);
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
    const contextCapacityFailure = projectChatContextCapacityFailure(error);
    const message = [
      String(details.error || '').trim(),
      typeof details.reasonCode === 'string' && details.reasonCode.trim()
        ? `[${details.reasonCode.trim()}]`
        : '',
    ].filter(Boolean).join(' ');
    logRendererEvent({
      level: 'error',
      area: 'agent-chat-shell',
      message: 'action:host-error',
      details,
    });
    setHostFeedback({
      kind: 'error',
      message: contextCapacityFailure
        ? chatContextCapacityFailureMessage(contextCapacityFailure, t)
        : message,
      ...(contextCapacityFailure ? {
        actionLabel: t('Chat.openLocalAIConfigurations', {
          defaultValue: 'Open Loadouts',
        }),
        onAction: () => {
          setActiveTab('runtime');
          runtimeConfigNavigation.focusAction({
            page: 'loadouts',
            action: 'open-loadouts',
            focus: 'runtime-config-action-focus.loadouts',
          });
        },
      } : {}),
    });
  }, [buildHostErrorDetails, runtimeConfigNavigation, setActiveTab, t]);

  return {
    buildHostErrorDetails,
    hostFeedback,
    reportHostError,
    setHostFeedback,
  };
}

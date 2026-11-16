import { LocalAppConversationSubmissionRecovery } from '@nimiplatform/kit/features/chat/ui';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { chatRuntimeReasonCodeMessage, localAgentConfigurationFailure } from './chat-runtime-error-message.js';

export function AgentSubmissionRecovery(props: Omit<ComponentProps<typeof LocalAppConversationSubmissionRecovery>, 'translate' | 'describeError' | 'isConfigurationError'>) {
  const { t } = useTranslation();
  return <LocalAppConversationSubmissionRecovery {...props} translate={(key, values) => t(key, values)}
    describeError={code => chatRuntimeReasonCodeMessage(code, t, { localAgent: true })}
    isConfigurationError={localAgentConfigurationFailure} />;
}

import { LocalAppConversationFollowUpControl } from '@nimiplatform/kit/features/chat/ui';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

export function AgentFollowUpControl(props: Omit<ComponentProps<typeof LocalAppConversationFollowUpControl>, 'translate'>) {
  const { t } = useTranslation();
  return <LocalAppConversationFollowUpControl {...props} translate={(key, values) => t(key, values)} />;
}

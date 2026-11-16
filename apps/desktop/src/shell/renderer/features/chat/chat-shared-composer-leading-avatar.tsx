import { useTranslation } from 'react-i18next';
import { Avatar } from '@nimiplatform/kit/ui';
import { ChatPartnerAvatarCard } from './chat-partner-avatar-card.js';

export function ChatComposerLeadingAvatar(props: {
  kind: 'agent'; agentHandle: string; name: string; imageUrl?: string | null; fallbackLabel?: string | null;
}) {
  const { t } = useTranslation();
  const name = props.name.trim() || props.fallbackLabel?.trim() || '?';
  return <ChatPartnerAvatarCard agentHandle={props.agentHandle} name={name} avatarUrl={props.imageUrl} placement="composer">
    <button type="button" data-chat-shared-composer-leading-avatar="true" aria-label={t('Chat.partnerCard.open', { name })}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
      <Avatar src={props.imageUrl || null} alt="" shape="circle" tone="neutral" className="h-8 w-8" fallback={name.slice(0, 1)} />
    </button>
  </ChatPartnerAvatarCard>;
}

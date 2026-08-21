import { SendGiftModal } from '../economy/send-gift-modal.js';
import type { RealmChatViewDto } from '@nimiplatform/kit/features/chat/realm';
import { useTranslation } from 'react-i18next';

type HumanConversationGiftModalProps = {
  open: boolean;
  selectedChat: RealmChatViewDto | null;
  onClose: () => void;
};

export function HumanConversationGiftModal({
  open,
  selectedChat,
  onClose,
}: HumanConversationGiftModalProps) {
  const { t } = useTranslation();
  const otherUser = selectedChat?.otherUser;
  const otherUserId = String(otherUser?.id || '').trim();
  const contactName = String(otherUser?.displayName || otherUser?.handle || t('Common.unknown', { defaultValue: 'Unknown' })).trim();
  const contactAvatarUrl = otherUser?.avatarUrl || null;

  return (
    <SendGiftModal
      open={open && Boolean(otherUserId)}
      receiverId={otherUserId}
      receiverName={contactName}
      receiverHandle={String(otherUser?.handle || '')}
      receiverIsSource={false}
      receiverAvatarUrl={contactAvatarUrl}
      onClose={onClose}
      onSent={onClose}
    />
  );
}

import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal.js';
import type { HumanChatViewDto } from '@renderer/features/chat/chat-human-thread-model';

type HumanConversationGiftModalProps = {
  open: boolean;
  selectedChat: HumanChatViewDto | null;
  onClose: () => void;
};

export function HumanConversationGiftModal({
  open,
  selectedChat,
  onClose,
}: HumanConversationGiftModalProps) {
  const { t } = useTranslation();
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const otherUser = selectedChat?.otherUser;
  const otherUserId = String(otherUser?.id || '').trim();
  const contactName = String(otherUser?.displayName || otherUser?.handle || 'Chat').trim();
  const contactAvatarUrl = otherUser?.avatarUrl || null;

  return (
    <SendGiftModal
      open={open && Boolean(otherUserId)}
      receiverId={otherUserId}
      receiverName={contactName}
      receiverHandle={String(otherUser?.handle || '')}
      receiverIsAgent={otherUser?.isAgent === true}
      receiverAvatarUrl={contactAvatarUrl}
      onClose={onClose}
      onSent={() => {
        setStatusBanner({
          kind: 'success',
          message: t('Contacts.giftSentTo', {
            name: contactName,
            defaultValue: 'Gift sent to {{name}}',
          }),
        });
      }}
    />
  );
}

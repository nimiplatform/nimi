import { SendGiftModal } from '../economy/send-gift-modal.js';
import type { RealmChatViewDto } from '@nimiplatform/kit/features/chat/realm';

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
      receiverIsSource={false}
      receiverAvatarUrl={contactAvatarUrl}
      onClose={onClose}
      onSent={onClose}
    />
  );
}

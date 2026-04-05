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
      onSent={onClose}
    />
  );
}

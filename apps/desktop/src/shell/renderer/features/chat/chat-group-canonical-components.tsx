import { useCallback } from 'react';
import type {
  CanonicalMessageAvatarSlot,
  CanonicalTranscriptViewProps,
  CanonicalStagePanelProps,
  ConversationCanonicalMessage,
} from '@nimiplatform/kit/features/chat';
import { EntityAvatar } from '../../components/entity-avatar.js';

function resolveSenderName(message: ConversationCanonicalMessage): string {
  return String(message.senderName || '').trim() || 'User';
}

export function useGroupMessageAvatarRenderer(): CanonicalMessageAvatarSlot {
  return useCallback<CanonicalMessageAvatarSlot>((message) => {
    const senderName = resolveSenderName(message);
    return (
      <div className="shrink-0">
        <EntityAvatar
          imageUrl={message.senderAvatarUrl || undefined}
          name={senderName}
          kind="human"
          sizeClassName="h-8 w-8"
          textClassName="text-xs font-medium"
          fallbackClassName="bg-slate-200 text-slate-700"
        />
      </div>
    );
  }, []);
}

export function useGroupCanonicalTranscriptProps(): Pick<CanonicalTranscriptViewProps, 'renderMessageAvatar'> {
  const renderMessageAvatar = useGroupMessageAvatarRenderer();
  return { renderMessageAvatar };
}

export function useGroupCanonicalStagePanelProps(): Pick<CanonicalStagePanelProps, 'renderMessageAvatar'> {
  const renderMessageAvatar = useGroupMessageAvatarRenderer();
  return { renderMessageAvatar };
}

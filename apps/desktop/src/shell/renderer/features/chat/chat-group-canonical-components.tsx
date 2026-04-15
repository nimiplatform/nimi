import { useCallback } from 'react';
import type {
  CanonicalMessageAvatarSlot,
  CanonicalTranscriptViewProps,
  CanonicalStagePanelProps,
  ConversationCanonicalMessage,
} from '@nimiplatform/nimi-kit/features/chat';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';

function resolveSenderName(message: ConversationCanonicalMessage): string {
  return String(message.senderName || '').trim() || (message.senderKind === 'agent' ? 'Agent' : 'User');
}

export function useGroupMessageAvatarRenderer(): CanonicalMessageAvatarSlot {
  return useCallback<CanonicalMessageAvatarSlot>((message) => {
    const senderName = resolveSenderName(message);
    const senderKind = message.senderKind === 'agent' ? 'agent' : 'human';
    return (
      <div className="shrink-0">
        <EntityAvatar
          imageUrl={message.senderAvatarUrl || undefined}
          name={senderName}
          kind={senderKind}
          sizeClassName="h-8 w-8"
          textClassName="text-xs font-medium"
          fallbackClassName={senderKind === 'human' ? 'bg-slate-200 text-slate-700' : undefined}
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

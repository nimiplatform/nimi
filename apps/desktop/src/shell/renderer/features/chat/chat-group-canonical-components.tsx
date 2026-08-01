import { useCallback } from 'react';
import type {
  CanonicalMessageAvatarSlot,
  CanonicalTranscriptViewProps,
  CanonicalStagePanelProps,
  ConversationCanonicalMessage,
} from '@nimiplatform/kit/features/chat';
import { EntityAvatar } from '../../components/entity-avatar.js';
import {
  CHAT_CONTENT_POSITION_CLASS,
  CHAT_CONTENT_WIDTH_CLASS,
  CHAT_TRANSCRIPT_BOTTOM_RESERVE_CLASS,
  CHAT_TRANSCRIPT_SCROLL_POSITION_CLASS,
  CHAT_TRANSCRIPT_SCROLL_VIEWPORT_CLASS,
} from './chat-shared-content-layout';

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

export function useGroupCanonicalTranscriptProps(): Pick<
  CanonicalTranscriptViewProps,
  'renderMessageAvatar' | 'widthClassName' | 'widthPositionClassName' | 'scrollViewportWidthClassName' | 'scrollViewportPositionClassName' | 'contentPaddingBottomClassName'
> {
  const renderMessageAvatar = useGroupMessageAvatarRenderer();
  return {
    renderMessageAvatar,
    widthClassName: CHAT_CONTENT_WIDTH_CLASS,
    widthPositionClassName: CHAT_CONTENT_POSITION_CLASS,
    scrollViewportWidthClassName: CHAT_TRANSCRIPT_SCROLL_VIEWPORT_CLASS,
    scrollViewportPositionClassName: CHAT_TRANSCRIPT_SCROLL_POSITION_CLASS,
    contentPaddingBottomClassName: CHAT_TRANSCRIPT_BOTTOM_RESERVE_CLASS,
  };
}

export function useGroupCanonicalStagePanelProps(): Pick<CanonicalStagePanelProps, 'renderMessageAvatar'> {
  const renderMessageAvatar = useGroupMessageAvatarRenderer();
  return { renderMessageAvatar };
}

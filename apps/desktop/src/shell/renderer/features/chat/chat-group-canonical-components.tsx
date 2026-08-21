import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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

function resolveSenderName(message: ConversationCanonicalMessage, fallback: string): string {
  return String(message.senderName || '').trim() || fallback;
}

export function useGroupMessageAvatarRenderer(): CanonicalMessageAvatarSlot {
  const { t } = useTranslation();
  const unknownSender = t('Common.unknown', { defaultValue: 'Unknown' });
  return useCallback<CanonicalMessageAvatarSlot>((message) => {
    const senderName = resolveSenderName(message, unknownSender);
    return (
      <div className="shrink-0">
        <EntityAvatar
          imageUrl={message.senderAvatarUrl || undefined}
          name={senderName}
          kind="human"
          sizeClassName="h-8 w-8"
          textClassName="text-xs font-medium"
          fallbackClassName="bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]"
        />
      </div>
    );
  }, [unknownSender]);
}

export function useGroupCanonicalTranscriptProps(): Pick<
  CanonicalTranscriptViewProps,
  'renderMessageAvatar' | 'widthClassName' | 'widthPositionClassName' | 'scrollViewportWidthClassName' | 'scrollViewportPositionClassName' | 'contentPaddingBottomClassName' | 'emptyEyebrow' | 'emptyTitle' | 'emptyDescription' | 'loadingLabel'
> {
  const { t } = useTranslation();
  const renderMessageAvatar = useGroupMessageAvatarRenderer();
  return {
    renderMessageAvatar,
    emptyEyebrow: t('Chat.groupTranscriptEmptyEyebrow', { defaultValue: 'Group' }),
    emptyTitle: t('Chat.groupTranscriptEmptyTitle', { defaultValue: 'Start the group conversation' }),
    emptyDescription: t('Chat.groupTranscriptEmpty', { defaultValue: 'Send a message to begin this group chat.' }),
    loadingLabel: t('MessagePane.loadingConversation', { defaultValue: 'Loading conversation…' }),
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

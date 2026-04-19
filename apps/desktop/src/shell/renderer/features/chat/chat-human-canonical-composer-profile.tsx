import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageType } from '@nimiplatform/sdk/realm';
import { CanonicalComposer } from '@nimiplatform/nimi-kit/features/chat';
import { createRealmChatComposerAdapter } from '@nimiplatform/nimi-kit/features/chat/realm';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ChatProfileCard } from '../turns/message-timeline-profile-card.js';
import { toChatProfileSummary } from '../turns/message-timeline-utils.js';
import { toProfileData } from '@renderer/features/profile/profile-model';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { createChatUploadPlaceholder, addChatUploadPlaceholder, removeChatUploadPlaceholder } from '../turns/chat-upload-placeholder-store';
import { createCanonicalChatAttachmentPayload, extractChatAttachmentTargetId } from '../turns/chat-attachment-contract.js';
import { mergeSentRealmChatMessageIntoCache } from '../turns/chat-send-cache.js';
import { formatPendingAttachmentSize, appendPendingAttachment, clearPendingAttachments, type PendingAttachment } from '../turns/turn-input-attachments';
import type { HumanChatViewDto } from './chat-human-thread-model';
import { ChatComposerLeadingAvatar } from './chat-composer-leading-avatar';

function HumanAttachmentStrip(props: {
  attachments: readonly PendingAttachment[];
  removeAttachment: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      {props.attachments.map((attachment, index) => (
        <div key={`${attachment.previewUrl}-${index}`} className="relative shrink-0">
          {attachment.kind === 'image' ? (
            <img
              src={attachment.previewUrl}
              alt={t('ChatTimeline.imageMessage', 'Image')}
              className="block h-20 w-20 rounded-xl object-cover"
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_6px_20px_rgba(15,23,42,0.08)]">
              <div className="relative h-24 w-40 overflow-hidden bg-gray-900">
                <video
                  src={attachment.previewUrl}
                  className="block h-full w-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              </div>
              <div className="w-40 px-3 py-2">
                <p className="truncate text-[12px] font-medium leading-4 text-gray-900">{attachment.name}</p>
                <p className="mt-1 text-[11px] leading-4 text-gray-500">{formatPendingAttachmentSize(attachment.file.size)}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => props.removeAttachment(index)}
            className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-black/85"
            aria-label={t('TurnInput.removeAttachment')}
            title={t('TurnInput.removeAttachment')}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

export function HumanCanonicalComposer(props: {
  selectedChatId: string | null;
  leadingAvatar?: {
    name: string;
    imageUrl?: string | null;
    fallbackLabel?: string | null;
  } | null;
}) {
  const { t } = useTranslation();
  const offlineTier = useAppStore((state) => state.offlineTier);
  const currentUserId = String(useAppStore((state) => state.auth.user?.id) || '');
  const [isUploading, setIsUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pickerResolverRef = useRef<((attachments: readonly PendingAttachment[] | PromiseLike<readonly PendingAttachment[] | null> | null) => void) | null>(null);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => () => {
    if (pendingAttachmentsRef.current.length > 0) {
      clearPendingAttachments(pendingAttachmentsRef.current, (url) => URL.revokeObjectURL(url));
    }
  }, []);

  const mergeSentMessageIntoCache = (message: Awaited<ReturnType<typeof dataSync.sendMessage>>) => {
    mergeSentRealmChatMessageIntoCache({
      queryClient,
      message,
      currentUserId,
      selectedChatId: props.selectedChatId,
    });
  };

  const uploadPendingAttachment = useCallback(async (attachment: PendingAttachment) => {
    if (!props.selectedChatId) {
      throw new Error(t('TurnInput.selectChatFirst'));
    }

    const { file, kind } = attachment;
    const isImage = kind === 'image';
    const uploadInfo = isImage
      ? await dataSync.createImageDirectUpload()
      : await dataSync.createVideoDirectUpload();
    const uploadUrl = uploadInfo.uploadUrl;
    const attachmentTargetId = extractChatAttachmentTargetId(uploadInfo);
    if (!uploadUrl) {
      throw new Error(t('TurnInput.uploadFailed'));
    }

    const formData = new FormData();
    formData.append('file', file);
    let uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });
    if (!uploadResponse.ok) {
      uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });
    }
    if (!uploadResponse.ok) {
      throw new Error(t('TurnInput.uploadFailed'));
    }

    const finalized = await dataSync.finalizeResource(attachmentTargetId, {});
    const finalizedAttachmentTargetId = String(finalized.id || '').trim();
    if (!finalizedAttachmentTargetId) {
      throw new Error(t('TurnInput.uploadFailed'));
    }

    return await dataSync.sendMessage(props.selectedChatId, '', {
      type: MessageType.ATTACHMENT,
      payload: createCanonicalChatAttachmentPayload(finalizedAttachmentTargetId),
    });
  }, [props.selectedChatId, t]);

  const handleAttachmentFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    let built: PendingAttachment[] = [];
    for (const file of files) {
      const next = appendPendingAttachment(built, file, {
        createObjectUrl: (nextFile) => URL.createObjectURL(nextFile),
        revokeObjectUrl: (url) => URL.revokeObjectURL(url),
      });
      if (!next) {
        setFeedback({
          kind: 'error',
          message: t('TurnInput.unsupportedFileType'),
        });
        continue;
      }
      built = next;
    }
    pickerResolverRef.current?.(built.length > 0 ? built : null);
    pickerResolverRef.current = null;
    event.target.value = '';
  }, [t]);

  const attachmentAdapter = useMemo(() => ({
    openPicker: async () => {
      if (!props.selectedChatId || offlineTier === 'L2') {
        return null;
      }
      return await new Promise<readonly PendingAttachment[] | null>((resolve) => {
        pickerResolverRef.current = resolve;
        fileInputRef.current?.click();
      });
    },
    mergeAttachments: (current: readonly PendingAttachment[], incoming: readonly PendingAttachment[]) => [
      ...current,
      ...incoming,
    ],
  }), [offlineTier, props.selectedChatId]);

  const handleAttachmentsChange = useCallback((nextAttachments: readonly PendingAttachment[]) => {
    setPendingAttachments((current) => {
      const nextUrlSet = new Set(nextAttachments.map((attachment) => attachment.previewUrl));
      for (const attachment of current) {
        if (!nextUrlSet.has(attachment.previewUrl)) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      return [...nextAttachments];
    });
  }, []);

  const handleSendAttachments = useCallback(async (attachments: readonly PendingAttachment[]) => {
    if (!props.selectedChatId) {
      return;
    }
    setIsUploading(true);
    try {
      for (const attachment of attachments) {
        const placeholder = createChatUploadPlaceholder({
          chatId: props.selectedChatId,
          previewUrl: attachment.previewUrl,
          kind: attachment.kind,
          senderId: currentUserId || 'local-user',
        });
        addChatUploadPlaceholder(placeholder);
        try {
          const message = await uploadPendingAttachment(attachment);
          mergeSentMessageIntoCache(message);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['messages', message.chatId] }),
            queryClient.invalidateQueries({ queryKey: ['chats'] }),
          ]);
          removeChatUploadPlaceholder(placeholder.id);
        } catch (error) {
          removeChatUploadPlaceholder(placeholder.id);
          throw error;
        }
      }
    } finally {
      setIsUploading(false);
    }
  }, [currentUserId, props.selectedChatId, uploadPendingAttachment]);

  const textSendAdapter = useMemo(() => createRealmChatComposerAdapter({
    chatId: props.selectedChatId || '',
    service: {
      sendMessage: async (chatId, input) => dataSync.sendMessage(chatId, String(input.text || ''), input),
    },
    onResponse: async (message) => {
      mergeSentMessageIntoCache(message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['messages', message.chatId] }),
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
      ]);
    },
  }), [currentUserId, props.selectedChatId]);

  const adapter = useMemo(() => ({
    submit: async ({ text, attachments }: { text: string; attachments: readonly PendingAttachment[] }) => {
      if (offlineTier === 'L2') {
        setFeedback({
          kind: 'warning',
          message: t('TurnInput.runtimeUnavailableReadOnly'),
        });
        return;
      }
      if (attachments.length > 0) {
        try {
          await handleSendAttachments(attachments);
          setPendingAttachments((current) => {
            clearPendingAttachments(current, (url) => URL.revokeObjectURL(url));
            return [];
          });
        } catch (error) {
          setFeedback({
            kind: 'error',
            message: error instanceof Error ? error.message : t('TurnInput.uploadFailed'),
          });
          return;
        }
      }
      if (text.trim()) {
        await textSendAdapter.submit({ text, attachments: [] });
      }
    },
  }), [handleSendAttachments, offlineTier, t, textSendAdapter]);

  return (
    <>
      {feedback ? (
        <div className="px-4 pb-3">
          <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
        </div>
      ) : null}
      <CanonicalComposer
        adapter={adapter}
        disabled={!props.selectedChatId || isUploading || offlineTier === 'L2'}
        placeholder={offlineTier === 'L2'
          ? t('TurnInput.runtimeUnavailablePlaceholder')
          : t('TurnInput.typeMessage')}
        attachmentAdapter={attachmentAdapter}
        attachments={pendingAttachments}
        onAttachmentsChange={handleAttachmentsChange}
        attachmentsSlot={({ attachments, removeAttachment }) => (
          <HumanAttachmentStrip
            attachments={attachments as readonly PendingAttachment[]}
            removeAttachment={removeAttachment}
          />
        )}
        attachLabel={t('TurnInput.uploadFile')}
        runtimeHint={offlineTier === 'L2' ? t('TurnInput.runtimeUnavailableReadOnly') : null}
        layout="stacked"
        leadingSlot={props.leadingAvatar ? (
          <ChatComposerLeadingAvatar
            kind="human"
            name={props.leadingAvatar.name}
            imageUrl={props.leadingAvatar.imageUrl || null}
            fallbackLabel={props.leadingAvatar.fallbackLabel || props.leadingAvatar.name}
          />
        ) : null}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        onChange={handleAttachmentFileChange}
        className="hidden"
        aria-hidden="true"
      />
    </>
  );
}

export function HumanCanonicalProfileDrawer(props: {
  selectedChat: HumanChatViewDto | null;
  onOpenGift?: () => void;
}) {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUser = useAppStore((state) => state.auth.user);
  const currentUserId = String(currentUser?.id || '');
  const navigateToProfile = useAppStore((state) => state.navigateToProfile);
  const profilePanelTarget = useAppStore((state) => state.chatProfilePanelTarget);
  const setProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);
  const otherUser = props.selectedChat?.otherUser;
  const otherUserId = String(otherUser?.id || '').trim();
  const currentUserFallback = currentUser && typeof currentUser === 'object'
    ? (currentUser as unknown as Record<string, unknown>)
    : null;
  const otherUserFallback = (otherUser as unknown as Record<string, unknown>) || null;
  const profileTargetId = profilePanelTarget === 'self' ? currentUserId : otherUserId;

  const profileQuery = useQuery({
    queryKey: ['chat-contact-profile', profilePanelTarget, profileTargetId],
    queryFn: async () => {
      if (!profileTargetId) {
        return null;
      }
      const result = await dataSync.loadUserProfile(profileTargetId);
      return result as Record<string, unknown>;
    },
    enabled: authStatus === 'authenticated' && profilePanelTarget !== null && Boolean(profileTargetId),
  });

  const profileSummary = useMemo(() => {
    const fallback = profilePanelTarget === 'self' ? currentUserFallback : otherUserFallback;
    return toChatProfileSummary({
      fallback,
      profile: (profileQuery.data as Record<string, unknown> | undefined) || null,
    });
  }, [currentUserFallback, otherUserFallback, profilePanelTarget, profileQuery.data]);

  const profileActionLabel = profilePanelTarget === 'self'
    ? t('ChatTimeline.openMyProfile')
    : t('ChatTimeline.openUserProfile');

  if (profilePanelTarget === null) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-4 py-4">
      <ChatProfileCard
        profileData={toProfileData(profileQuery.data || profileSummary)}
        onClose={() => setProfilePanelTarget(null)}
        onViewFullProfile={() => {
          if (!profileSummary.id) {
            return;
          }
          navigateToProfile(profileSummary.id, 'profile');
        }}
        viewFullProfileLabel={profileActionLabel}
        onOpenGift={profilePanelTarget === 'other' && profileSummary.id ? props.onOpenGift : undefined}
      />
    </div>
  );
}

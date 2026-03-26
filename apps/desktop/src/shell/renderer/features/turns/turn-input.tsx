import { useState, useRef, useEffect, useMemo, type ChangeEvent, type ClipboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { SlotHost } from '@renderer/mod-ui/host/slot-host';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import { getShellFeatureFlags } from '@nimiplatform/nimi-kit/core/shell-mode';
import { useChatComposer } from '@nimiplatform/nimi-kit/features/chat/headless';
import { createRealmChatComposerAdapter } from '@nimiplatform/nimi-kit/features/chat/realm';
import { MessageType } from '@nimiplatform/sdk/realm';
import {
  addChatUploadPlaceholder,
  createChatUploadPlaceholder,
  removeChatUploadPlaceholder,
} from './chat-upload-placeholder-store';
import {
  appendPendingAttachment,
  clearPendingAttachments,
  formatPendingAttachmentSize,
  getTurnInputSendPlan,
  removePendingAttachmentAt,
  type PendingAttachment,
} from './turn-input-attachments';
import {
  createCanonicalChatAttachmentPayload,
  extractChatAttachmentTargetId,
} from './chat-attachment-contract.js';
import { mergeSentRealmChatMessageIntoCache } from './chat-send-cache.js';
import { EMOJI_CATEGORIES } from './emoji-data';

type TurnInputProps = {
  className?: string;
  showTopBorder?: boolean;
  onOpenGift?: () => void;
};

type TooltipProps = {
  children: ReactNode;
  content: string;
  placement?: 'top' | 'bottom';
};

function Tooltip({ children, content, placement = 'top' }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  const positionClass = placement === 'bottom' 
    ? 'top-full mt-2' 
    : 'bottom-full mb-2';
  
  const hiddenTransform = placement === 'bottom' ? '-translate-y-1' : 'translate-y-1';
  const visibleTransform = placement === 'bottom' ? 'translate-y-0' : '-translate-y-0';

  return (
    <div
      className="relative flex items-center justify-center"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      <div
        className={`absolute ${positionClass} z-50 transition-all duration-200 ${
          isVisible ? `opacity-100 ${visibleTransform}` : `opacity-0 ${hiddenTransform} pointer-events-none`
        }`}
      >
        <div className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.25)] whitespace-nowrap">
          {content}
        </div>
      </div>
    </div>
  );
}

export function TurnInput(props: TurnInputProps = {}) {
  const { onOpenGift } = props;
  const { t } = useTranslation();
  const flags = getShellFeatureFlags();
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const offlineTier = useAppStore((state) => state.offlineTier);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const currentUserId = String(useAppStore((state) => state.auth.user?.id) || '');
  const [isFocused, setIsFocused] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState(0);
  const [emojiCategoryPage, setEmojiCategoryPage] = useState(0);
  const [showUploadPickerActive, setShowUploadPickerActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const context = useUiExtensionContext();

  // Categories per page
  const CATEGORIES_PER_PAGE = 4;
  const totalCategoryPages = Math.ceil(EMOJI_CATEGORIES.length / CATEGORIES_PER_PAGE);
  const activeCategory = EMOJI_CATEGORIES[activeEmojiCategory] ?? EMOJI_CATEGORIES[0] ?? {
    name: 'Default',
    emojis: [] as string[],
  };

  // Get categories for current page
  const getCategoriesForPage = (page: number) => {
    const start = page * CATEGORIES_PER_PAGE;
    const end = start + CATEGORIES_PER_PAGE;
    return EMOJI_CATEGORIES.slice(start, end).map((cat, idx) => ({
      ...cat,
      originalIndex: start + idx
    }));
  };

  const setEmojiPage = (page: number) => {
    const boundedPage = Math.max(0, Math.min(totalCategoryPages - 1, page));
    const nextPageCategories = getCategoriesForPage(boundedPage);
    setEmojiCategoryPage(boundedPage);
    if (nextPageCategories[0]) {
      setActiveEmojiCategory(nextPageCategories[0].originalIndex);
    }
  };

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node) &&
        emojiButtonRef.current &&
        !emojiButtonRef.current.contains(event.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker]);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => () => {
    if (pendingAttachmentsRef.current.length > 0) {
      clearPendingAttachments(pendingAttachmentsRef.current, (url) => URL.revokeObjectURL(url));
    }
  }, []);

  useEffect(() => {
    if (!showUploadPickerActive) {
      return;
    }

    const handleWindowFocus = () => {
      window.setTimeout(() => {
        setShowUploadPickerActive(false);
      }, 120);
    };

    window.addEventListener('focus', handleWindowFocus, true);
    return () => {
      window.removeEventListener('focus', handleWindowFocus, true);
    };
  }, [showUploadPickerActive]);

  const setPendingAttachmentFromFile = (file: File) => {
    const nextAttachments = appendPendingAttachment(pendingAttachments, file, {
      createObjectUrl: (nextFile) => URL.createObjectURL(nextFile),
      revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    });

    if (!nextAttachments) {
      setStatusBanner({
        kind: 'error',
        message: t('TurnInput.unsupportedFileType'),
      });
      return;
    }

    setPendingAttachments(nextAttachments);
  };

  const removePendingAttachment = (index: number) => {
    setPendingAttachments((current) => removePendingAttachmentAt(current, index, (url) => URL.revokeObjectURL(url)));
  };

  const insertEmoji = (emoji: string) => {
    const textarea = composer.textareaRef.current;
    if (!textarea) {
      composer.setText(composer.text + emoji);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = composer.text.slice(0, start) + emoji + composer.text.slice(end);
    composer.setText(newText);

    // Restore focus and set cursor position after emoji
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + emoji.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const readOnlyMessage = t('TurnInput.runtimeUnavailableReadOnly');
  const uploadBlockedMessage = t('TurnInput.runtimeUnavailableUpload');

  const mergeSentMessageIntoCache = (message: Awaited<ReturnType<typeof dataSync.sendMessage>>) => {
    mergeSentRealmChatMessageIntoCache({
      queryClient,
      message,
      currentUserId,
      selectedChatId,
    });
  };

  const uploadPendingAttachment = async (attachment: PendingAttachment) => {
    if (offlineTier === 'L2') {
      throw new Error(uploadBlockedMessage);
    }
    if (!selectedChatId) {
      throw new Error(t('TurnInput.selectChatFirst'));
    }

    const { file, kind } = attachment;
    const isImage = kind === 'image';

    let uploadUrl: string;
    let attachmentTargetId: string;

    if (isImage) {
      const uploadInfo = await dataSync.createImageDirectUpload();
      uploadUrl = uploadInfo.uploadUrl;
      attachmentTargetId = extractChatAttachmentTargetId(uploadInfo);
    } else {
      const uploadInfo = await dataSync.createVideoDirectUpload();
      uploadUrl = uploadInfo.uploadUrl;
      attachmentTargetId = extractChatAttachmentTargetId(uploadInfo);
    }

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

    return await dataSync.sendMessage(selectedChatId, '', {
      type: MessageType.ATTACHMENT,
      payload: createCanonicalChatAttachmentPayload(finalizedAttachmentTargetId),
    });
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    setShowUploadPickerActive(false);
    const file = event.target.files?.[0];
    if (file) {
      setPendingAttachmentFromFile(file);
    }
    // Reset input so the same file can be selected again
    event.target.value = '';
  };

  const handleUploadClick = () => {
    if (offlineTier === 'L2') {
      setStatusBanner({
        kind: 'warning',
        message: uploadBlockedMessage,
      });
      return;
    }
    setShowUploadPickerActive(true);
    fileInputRef.current?.click();
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (!imageItem) {
      return;
    }
    const file = imageItem.getAsFile();
    if (!file) {
      return;
    }
    event.preventDefault();
    setPendingAttachmentFromFile(file);
  };

  const handleSend = async (payload: { text: string; attachments: readonly PendingAttachment[] }) => {
    if (offlineTier === 'L2') {
      setStatusBanner({
        kind: 'warning',
        message: readOnlyMessage,
      });
      return;
    }
    if (!selectedChatId) {
      return;
    }
    if (payload.attachments.length > 0) {
      try {
        setIsUploading(true);
        for (const attachment of payload.attachments) {
          const placeholder = createChatUploadPlaceholder({
            chatId: selectedChatId,
            previewUrl: attachment.previewUrl,
            kind: attachment.kind,
            senderId: currentUserId || 'local-user',
          });
          addChatUploadPlaceholder(placeholder);
          try {
            const message = await uploadPendingAttachment(attachment);
            mergeSentMessageIntoCache(message);
            setPendingAttachments((current) => removePendingAttachmentAt(current, 0, (url) => URL.revokeObjectURL(url)));
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
      } catch (error) {
        setStatusBanner({
          kind: 'error',
          message: error instanceof Error ? error.message : t('TurnInput.uploadFailed'),
        });
        return;
      } finally {
        setIsUploading(false);
      }
    }
  };

  const textSendAdapter = useMemo(() => createRealmChatComposerAdapter({
    chatId: selectedChatId || '',
    service: {
      sendMessage: async (chatId, input) => dataSync.sendMessage(
        chatId,
        String(input.text || ''),
        input,
      ),
    },
    onResponse: async (message) => {
      mergeSentMessageIntoCache(message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['messages', message.chatId] }),
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
      ]);
    },
  }), [currentUserId, selectedChatId]);

  const composer = useChatComposer<PendingAttachment>({
    adapter: {
      submit: async ({ text, attachments }) => {
        if (attachments.length > 0) {
          await handleSend({ text: '', attachments });
        }
        if (text.trim()) {
          await textSendAdapter.submit({ text, attachments: [] });
        }
      },
    },
    attachments: pendingAttachments,
    onAttachmentsChange: (nextAttachments) => {
      setPendingAttachments([...nextAttachments]);
    },
    disabled: !selectedChatId || isUploading || offlineTier === 'L2',
    onError: (error) => {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('TurnInput.sendFailed'),
      });
    },
  });

  const sendPlan = getTurnInputSendPlan({
    text: composer.text,
    pendingAttachments,
    hasSelectedChat: Boolean(selectedChatId),
    isReadOnly: offlineTier === 'L2',
    isSending: composer.isSubmitting || isUploading,
    isUploading,
  });
  const canSend = sendPlan.canSend;

  return (
    <section
      className={`${props.showTopBorder === false ? '' : 'border-t border-gray-100 '}relative flex h-full flex-col bg-white px-4 pb-4 pt-3 ${props.className || ''}`}
    >
      {/* Emoji Picker Popup */}
      {showEmojiPicker && (
        <div
          ref={emojiPickerRef}
          className="absolute bottom-full left-0 mb-2 ml-4 w-[320px] rounded-2xl bg-white shadow-[0_8px_32px_rgba(0,0,0,0.15)] border border-gray-100 overflow-hidden z-50"
        >
          {/* Emoji categories tabs with pagination */}
          <div className="relative border-b border-gray-100">
            <div className="flex items-center gap-1 px-2 py-2">
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {getCategoriesForPage(emojiCategoryPage).map((category) => (
                  <button
                    key={category.name}
                    type="button"
                    onClick={() => setActiveEmojiCategory(category.originalIndex)}
                    className={`flex-shrink-0 px-2.5 py-1.5 text-[11px] font-medium rounded-full transition-colors ${
                      activeEmojiCategory === category.originalIndex
                        ? 'bg-[#0066CC] text-white'
                        : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
              {totalCategoryPages > 1 ? (
                <button
                  type="button"
                  onClick={() => setEmojiPage(emojiCategoryPage === 0 ? emojiCategoryPage + 1 : emojiCategoryPage - 1)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  aria-label={emojiCategoryPage === 0 ? t('TurnInput.nextPage') : t('TurnInput.previousPage')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {emojiCategoryPage === 0 ? (
                      <path d="M9 18l6-6-6-6" />
                    ) : (
                      <path d="M15 18l-6-6 6-6" />
                    )}
                  </svg>
                </button>
              ) : null}
            </div>
          </div>

          {/* Emoji grid */}
          <ScrollArea className="max-h-[260px]" viewportClassName="max-h-[260px]" contentClassName="p-3">
            <div className="grid grid-cols-8 gap-1">
              {activeCategory.emojis.map((emoji, index) => (
                <button
                  key={`${emoji}-${index}`}
                  type="button"
                  onClick={() => insertEmoji(emoji)}
                  className="flex items-center justify-center h-8 w-8 text-xl hover:bg-gray-100 rounded-lg transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Input container with border */}
      <div className="relative flex h-full min-h-0 flex-col rounded-2xl border border-gray-200 bg-gray-50/50 p-3">
        <ScrollArea className="min-h-0 flex-1" viewportClassName="pr-2">
          {pendingAttachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingAttachments.map((attachment, index) => (
                <div key={`${attachment.previewUrl}-${index}`} className="relative shrink-0">
                  {attachment.kind === 'image' ? (
                    <img
                      src={attachment.previewUrl}
                      alt={t('ChatTimeline.imageMessage')}
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
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/10" />
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-[2px]">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5">
                              <path d="M8 5.14v14l11-7z" />
                            </svg>
                          </div>
                        </div>
                      </div>
                      <div className="w-40 px-3 py-2">
                        <p className="truncate text-[12px] font-medium leading-4 text-gray-900">{attachment.name}</p>
                        <p className="mt-1 text-[11px] leading-4 text-gray-500">{formatPendingAttachmentSize(attachment.file.size)}</p>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(index)}
                    disabled={isUploading}
                    className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50"
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
          ) : null}

          {/* Input area */}
          <textarea
            ref={composer.textareaRef}
            className="min-h-[44px] w-full resize-none bg-transparent px-1 py-1 text-[15px] leading-5 text-gray-900 outline-none placeholder:text-gray-400"
            rows={2}
            placeholder={offlineTier === 'L2'
              ? t('TurnInput.runtimeUnavailablePlaceholder')
              : t('TurnInput.typeMessage')}
            value={composer.text}
            disabled={!selectedChatId || composer.isSubmitting || isUploading || offlineTier === 'L2'}
            onChange={composer.handleTextChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onPaste={handlePaste}
            onKeyDown={composer.handleKeyDown}
          />
        </ScrollArea>

        {/* Toolbar row */}
        <div className="mt-2 flex shrink-0 items-center justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <Tooltip content={t('TurnInput.emoji')}>
              <button
                ref={emojiButtonRef}
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  showEmojiPicker
                    ? 'bg-[#0066CC] text-white'
                    : 'text-gray-500 hover:bg-gray-200/50 hover:text-gray-700'
                }`}
                aria-label={t('TurnInput.emoji')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                  <line x1="9" y1="9" x2="9.01" y2="9" />
                  <line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
              </button>
            </Tooltip>

            {/* File upload button */}
            <Tooltip content={t('TurnInput.uploadFile')}>
              <button
                type="button"
                onClick={handleUploadClick}
                disabled={!selectedChatId || composer.isSubmitting || isUploading || offlineTier === 'L2'}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
                  showUploadPickerActive || composer.isSubmitting || isUploading || pendingAttachments.length > 0
                    ? 'bg-[#0066CC] text-white'
                    : 'text-gray-500 hover:bg-gray-200/50 hover:text-gray-700'
                }`}
                aria-label={t('TurnInput.uploadFile')}
              >
                {isUploading ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                )}
              </button>
            </Tooltip>

            {/* Send gift button */}
            {onOpenGift ? (
              <Tooltip content={t('GiftSend.sendGift')}>
                <button
                  type="button"
                  onClick={onOpenGift}
                  disabled={!selectedChatId || offlineTier === 'L2'}
                  className="flex h-8 w-8 items-center justify-center rounded-full transition-colors text-gray-500 hover:bg-gray-200/50 hover:text-gray-700 disabled:opacity-40"
                  aria-label={t('GiftSend.sendGift')}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="8" width="18" height="4" rx="1" />
                    <path d="M12 8v13" />
                    <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
                    <path d="M7.5 8a2.5 2.5 0 1 1 0-5c2 0 4.5 2.2 4.5 5" />
                    <path d="M16.5 8a2.5 2.5 0 1 0 0-5c-2 0-4.5 2.2-4.5 5" />
                  </svg>
                </button>
              </Tooltip>
            ) : null}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleFileSelect}
              className="hidden"
              aria-hidden="true"
            />

            {flags.enableModUi ? (
              <SlotHost slot="chat.turn.input.toolbar" base={null} context={context} />
            ) : null}
          </div>

          {/* Send button */}
          <button
            type="button"
            onClick={() => {
              void composer.handleSubmit();
            }}
            disabled={!canSend}
            className={`ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all hover:bg-[#0052A3] disabled:opacity-40 disabled:cursor-not-allowed ${
              isFocused && (composer.text.trim() || pendingAttachments.length > 0)
                ? 'bg-[#0066CC] shadow-[0_0_12px_rgba(0,102,204,0.5)] scale-105' 
                : 'bg-[#0066CC]/70'
            }`}
            aria-label={t('TurnInput.send')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { cn, EmptyState } from '@nimiplatform/kit/ui';
import {
  getRealmChatTimelineDisplayModel,
  resolveRealmChatMediaUrl,
  type RealmChatTimelineDisplayModel,
  type RealmChatTimelineMessage,
} from '../realm.js';
import {
  CHAT_BUBBLE_MAX_WIDTH_CLASSNAME,
  CHAT_BUBBLE_TEXT_CLASSNAME,
  chatBubbleShapeStyle,
} from '../bubble-styles.js';
import { formatMessageTime } from '../utils/message-time.js';

export type RealmChatTimelineAvatarRenderInput = {
  message: RealmChatTimelineMessage;
  display: RealmChatTimelineDisplayModel;
  isMe: boolean;
  index: number;
};

export type RealmChatTimelineGiftRenderInput = {
  message: RealmChatTimelineMessage;
  display: RealmChatTimelineDisplayModel;
  isMe: boolean;
  index: number;
};

export type RealmChatTimelineMediaKind = 'image' | 'video';

export type RealmChatTimelineResolvedMediaSource = {
  url: string;
  dispose?: () => void;
};

export type RealmChatTimelineMediaResolveInput = {
  sourceUrl: string;
  kind: RealmChatTimelineMediaKind;
  message: RealmChatTimelineMessage;
};

export type RealmChatTimelineMediaResolver = (
  input: RealmChatTimelineMediaResolveInput,
) => RealmChatTimelineResolvedMediaSource | Promise<RealmChatTimelineResolvedMediaSource>;

export type RealmChatTimelineProps = {
  messages: readonly RealmChatTimelineMessage[];
  currentUserId: string;
  realmBaseUrl?: string;
  resolveMediaSource?: RealmChatTimelineMediaResolver;
  emptyState?: ReactNode;
  /** Title used by the default empty state when `emptyState` is not provided. */
  emptyStateLabel?: string;
  emptyMessageLabel?: string;
  imageMessageLabel?: string;
  videoMessageLabel?: string;
  queuedLocallyLabel?: string;
  sendFailedLabel?: string;
  uploadingMediaLabel?: string;
  yesterdayLabel?: string;
  className?: string;
  listClassName?: string;
  rowClassName?: string;
  userRowClassName?: string;
  otherRowClassName?: string;
  bubbleClassName?: string;
  userBubbleClassName?: string;
  otherBubbleClassName?: string;
  renderAvatar?: (input: RealmChatTimelineAvatarRenderInput) => ReactNode;
  renderGiftMessage?: (input: RealmChatTimelineGiftRenderInput) => ReactNode;
};

function toMessageTimestamp(message: Pick<RealmChatTimelineMessage, 'createdAt'>): number {
  const parsed = Date.parse(String(message.createdAt || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getDateKey(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function shouldShowTimestamp(
  currentMessage: RealmChatTimelineMessage,
  previousMessage: RealmChatTimelineMessage | null,
): boolean {
  if (!previousMessage) {
    return true;
  }
  const currentTime = toMessageTimestamp(currentMessage);
  const previousTime = toMessageTimestamp(previousMessage);
  if (getDateKey(currentMessage.createdAt) !== getDateKey(previousMessage.createdAt)) {
    return true;
  }
  return currentTime - previousTime > 300000;
}

function formatTimestamp(isoString: string, yesterdayLabel: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - messageDay.getTime()) / 86400000);
  const timeText = formatMessageTime(date);

  if (diffDays === 0) {
    return timeText;
  }
  if (diffDays === 1) {
    return `${yesterdayLabel} ${timeText}`;
  }
  if (diffDays < 7) {
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
    return `${weekday} ${timeText}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    const monthDay = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(date);
    return `${monthDay}, ${timeText}`;
  }
  const fullDate = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  return `${fullDate}, ${timeText}`;
}

function useResolvedMediaSource({
  src,
  kind,
  message,
  resolveMediaSource,
}: {
  src: string;
  kind: RealmChatTimelineMediaKind;
  message: RealmChatTimelineMessage;
  resolveMediaSource?: RealmChatTimelineMediaResolver;
}): string {
  const [resolvedSrc, setResolvedSrc] = useState(resolveMediaSource ? '' : src);

  useEffect(() => {
    const normalizedSrc = String(src || '').trim();
    if (!resolveMediaSource) {
      setResolvedSrc(normalizedSrc);
      return;
    }
    setResolvedSrc('');
    if (!normalizedSrc) {
      return;
    }

    let cancelled = false;
    let dispose: (() => void) | undefined;
    const run = async () => {
      try {
        const resolution = await resolveMediaSource({
          sourceUrl: normalizedSrc,
          kind,
          message,
        });
        const resolvedUrl = String(resolution?.url || '').trim();
        dispose = resolution?.dispose;
        if (cancelled) {
          dispose?.();
          dispose = undefined;
          return;
        }
        setResolvedSrc(resolvedUrl);
      } catch {
        setResolvedSrc('');
        return;
      }
    };
    void run();

    return () => {
      cancelled = true;
      dispose?.();
      dispose = undefined;
    };
  }, [src, kind, message, resolveMediaSource]);

  return resolvedSrc;
}

function ResolvedImage({
  src,
  alt,
  message,
  resolveMediaSource,
}: {
  src: string;
  alt: string;
  message: RealmChatTimelineMessage;
  resolveMediaSource?: RealmChatTimelineMediaResolver;
}) {
  const resolvedSrc = useResolvedMediaSource({
    src,
    kind: 'image',
    message,
    resolveMediaSource,
  });

  if (!resolvedSrc) {
    return <span>{alt}</span>;
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className="max-h-[320px] max-w-[260px] rounded-xl object-contain"
    />
  );
}

function ResolvedVideo({
  src,
  message,
  resolveMediaSource,
  uploading,
}: {
  src: string;
  message: RealmChatTimelineMessage;
  resolveMediaSource?: RealmChatTimelineMediaResolver;
  uploading: boolean;
}) {
  const resolvedSrc = useResolvedMediaSource({
    src,
    kind: 'video',
    message,
    resolveMediaSource,
  });

  if (!resolvedSrc) {
    return null;
  }

  return (
    <video
      src={resolvedSrc}
      controls={!uploading}
      muted={uploading}
      playsInline
      preload="metadata"
      className="max-h-[320px] max-w-[260px] rounded-xl"
    />
  );
}

export function RealmChatTimeline({
  messages,
  currentUserId,
  realmBaseUrl = '',
  resolveMediaSource,
  emptyState,
  emptyStateLabel = 'No messages',
  emptyMessageLabel = 'Empty message',
  imageMessageLabel = 'Image',
  videoMessageLabel = 'Video',
  queuedLocallyLabel = 'Queued locally',
  sendFailedLabel = 'Failed to send',
  uploadingMediaLabel = 'Uploading...',
  yesterdayLabel = 'Yesterday',
  className,
  listClassName,
  rowClassName,
  userRowClassName,
  otherRowClassName,
  bubbleClassName,
  userBubbleClassName,
  otherBubbleClassName,
  renderAvatar,
  renderGiftMessage,
}: RealmChatTimelineProps) {
  if (messages.length === 0) {
    return <>{emptyState ?? <EmptyState title={emptyStateLabel} />}</>;
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className={cn('', listClassName)}>
        {messages.map((message, index) => {
          const previousMessage = index > 0 ? (messages[index - 1] ?? null) : null;
          const display = getRealmChatTimelineDisplayModel(message, currentUserId);
          const isMe = display.isMe;
          const showTimestamp = shouldShowTimestamp(message, previousMessage);
          const timestampLabel = showTimestamp ? formatTimestamp(message.createdAt, yesterdayLabel) : '';
          const mediaUrl = display.localPreviewUrl
            || (display.isMediaMessage ? resolveRealmChatMediaUrl(message.payload, realmBaseUrl) : '');

          return (
            <div key={message.id || message.clientMessageId || index}>
              {showTimestamp && timestampLabel ? (
                <div className="my-6 flex items-center justify-center">
                  <span className="rounded-full bg-[var(--nimi-surface-panel)] px-3 py-1 text-[length:var(--nimi-type-overline-size)] font-medium text-[var(--nimi-text-muted)]">{timestampLabel}</span>
                </div>
              ) : null}
              <div
                className={cn(
                  'flex items-start gap-2',
                  isMe && 'flex-row-reverse',
                  rowClassName,
                  isMe ? userRowClassName : otherRowClassName,
                )}
              >
                {renderAvatar ? renderAvatar({ message, display, isMe, index }) : null}
                <div className={cn(CHAT_BUBBLE_MAX_WIDTH_CLASSNAME, isMe && 'text-right')}>
                  <div
                    className={cn(
                      'inline-block',
                      CHAT_BUBBLE_TEXT_CLASSNAME,
                      display.isMediaMessage || display.isGiftMessage
                        ? 'overflow-hidden bg-transparent p-0 text-[var(--nimi-text-primary)]'
                        : isMe
                          ? 'bg-[var(--nimi-action-primary-bg)] px-4 py-2.5 text-[var(--nimi-action-primary-text)]'
                          : 'bg-[var(--nimi-surface-card)] px-4 py-2.5 text-[var(--nimi-text-primary)]',
                      bubbleClassName,
                      isMe ? userBubbleClassName : otherBubbleClassName,
                    )}
                    style={chatBubbleShapeStyle(isMe ? 'user' : 'agent')}
                  >
                    {display.isGiftMessage && renderGiftMessage ? (
                      renderGiftMessage({ message, display, isMe, index })
                    ) : display.isImageMessage ? (
                      mediaUrl ? (
                        <div className="relative">
                          <ResolvedImage
                            src={mediaUrl}
                            alt={imageMessageLabel}
                            message={message}
                            resolveMediaSource={resolveMediaSource}
                          />
                          {display.isUploadingMedia ? (
                            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-overlay)_65%,transparent)]">
                              <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-[color-mix(in_srgb,var(--nimi-surface-overlay)_70%,transparent)] border-t-[var(--nimi-action-primary-bg)] shadow-sm" />
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span>{imageMessageLabel}</span>
                      )
                    ) : display.isVideoMessage ? (
                      mediaUrl ? (
                        <div className="relative">
                          <ResolvedVideo
                            src={mediaUrl}
                            message={message}
                            resolveMediaSource={resolveMediaSource}
                            uploading={display.isUploadingMedia}
                          />
                          {display.isUploadingMedia ? (
                            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-overlay-backdrop)_55%,transparent)]">
                              <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-[color-mix(in_srgb,var(--nimi-surface-overlay)_60%,transparent)] border-t-[var(--nimi-surface-overlay)] shadow-sm" />
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span>{videoMessageLabel}</span>
                      )
                    ) : (
                      display.resolvedText || emptyMessageLabel
                    )}
                  </div>
                  {display.showDeliveryState ? (
                    <div
                      className={cn(
                        'mt-1 px-1 text-[length:var(--nimi-type-overline-size)]',
                        isMe ? 'text-right' : 'text-left',
                        display.deliveryState === 'failed'
                          ? 'text-[var(--nimi-status-danger)]'
                          : 'text-[var(--nimi-status-warning)]',
                      )}
                    >
                      {display.isUploadingMedia
                        ? uploadingMediaLabel
                        : display.deliveryState === 'failed'
                          ? (display.deliveryError || sendFailedLabel)
                          : queuedLocallyLabel}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

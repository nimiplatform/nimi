import { Component, Suspense, lazy, memo, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle, IconButton, cn } from '@nimiplatform/kit/ui';
import type { ConversationCanonicalMessage } from '../types.js';
import { resolveChatCopy, type ChatCopy } from '../copy.js';
import {
  CHAT_BUBBLE_MAX_WIDTH_CLASSNAME,
  CHAT_BUBBLE_MEDIA_MAX_WIDTH_CLASSNAME,
  CHAT_BUBBLE_TEXT_CLASSNAME,
  chatBubbleShapeStyle,
} from '../bubble-styles.js';
import { formatMessageTime } from '../utils/message-time.js';
import { hasRpContent } from '../utils/rp-content-parser.js';

export type CanonicalBubbleDisplayContext = 'transcript' | 'stage';

type StageMediaPreviewKind = 'image' | 'video' | 'image-pending' | 'video-pending';

type BubbleShape = { className: string; style: CSSProperties };

const ChatMarkdownRenderer = lazy(async () => {
  try {
    const mod = await import('./chat-markdown-renderer.js');
    return { default: mod.ChatMarkdownRenderer };
  } catch (error) {
    throw createLazyImportError('canonical:markdown-renderer', error);
  }
});

const RpContentRenderer = lazy(async () => {
  try {
    const mod = await import('./rp-content-renderer.js');
    return { default: mod.RpContentRenderer };
  } catch (error) {
    throw createLazyImportError('canonical:rp-content-renderer', error);
  }
});

function createLazyImportError(label: string, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error || 'unknown import error');
  const wrapped = new Error(`${label}: ${reason}`);
  wrapped.name = 'LazyImportError';
  wrapped.cause = error;
  return wrapped;
}

function PlainTextMessageContent({ content }: { content: string }) {
  return <p className="my-2 whitespace-pre-wrap text-sm leading-[1.7] text-[var(--nimi-text-primary)]">{content}</p>;
}

type LazyMessageContentBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  resetKey: string;
};

type LazyMessageContentBoundaryState = {
  failed: boolean;
};

class LazyMessageContentBoundary extends Component<LazyMessageContentBoundaryProps, LazyMessageContentBoundaryState> {
  constructor(props: LazyMessageContentBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): LazyMessageContentBoundaryState {
    return { failed: true };
  }

  override componentDidUpdate(prevProps: LazyMessageContentBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function MarkdownMessageContent({ content, copy }: { content: string; copy: Required<ChatCopy> }) {
  const fallback = <PlainTextMessageContent content={content} />;
  return (
    <LazyMessageContentBoundary resetKey={`markdown:${content}`} fallback={fallback}>
      <Suspense fallback={fallback}>
        <ChatMarkdownRenderer content={content} appearance="canonical" copy={copy} />
      </Suspense>
    </LazyMessageContentBoundary>
  );
}

function RpMessageContent({ content }: { content: string }) {
  const fallback = <PlainTextMessageContent content={content} />;
  return (
    <LazyMessageContentBoundary resetKey={`rp:${content}`} fallback={fallback}>
      <Suspense fallback={fallback}>
        <RpContentRenderer content={content} appearance="canonical" />
      </Suspense>
    </LazyMessageContentBoundary>
  );
}

function bubbleShapeFor(role: ConversationCanonicalMessage['role']): BubbleShape {
  const isUser = role === 'user' || role === 'human';
  return { className: '', style: chatBubbleShapeStyle(isUser ? 'user' : 'agent') };
}

function entryAnimationFor(message: ConversationCanonicalMessage): string {
  if (message.kind === 'image' || message.kind === 'video' || message.kind === 'image-pending' || message.kind === 'video-pending') {
    return 'chat-scale-in';
  }
  if (message.role === 'assistant' || message.role === 'agent') {
    return 'chat-drift-in';
  }
  return 'chat-slide-up';
}

function readPositiveDimension(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function resolveCanonicalStageMediaPreviewMetrics(input: {
  kind: StageMediaPreviewKind;
  width?: number;
  height?: number;
}): {
  aspectRatio: number;
  previewWidthPx: number;
  previewHeightPx: number;
} {
  const sourceWidth = readPositiveDimension(input.width);
  const sourceHeight = readPositiveDimension(input.height);
  const fallbackSource = (input.kind === 'video' || input.kind === 'video-pending')
    ? { width: 1280, height: 720 }
    : { width: 1024, height: 1024 };
  const effectiveWidth = sourceWidth || fallbackSource.width;
  const effectiveHeight = sourceHeight || fallbackSource.height;
  const aspectRatio = effectiveWidth / effectiveHeight;
  const bounds = aspectRatio >= 1.45
    ? { maxWidth: 560, maxHeight: 280, minWidth: 300, minHeight: 170 }
    : aspectRatio <= 0.8
      ? { maxWidth: 320, maxHeight: 360, minWidth: 220, minHeight: 240 }
      : { maxWidth: 420, maxHeight: 320, minWidth: 260, minHeight: 220 };

  let scale = Math.min(bounds.maxWidth / effectiveWidth, bounds.maxHeight / effectiveHeight);
  let previewWidth = Math.round(effectiveWidth * scale);
  let previewHeight = Math.round(effectiveHeight * scale);

  if (previewWidth < bounds.minWidth) {
    const widthScale = bounds.minWidth / effectiveWidth;
    const widthScaledHeight = effectiveHeight * widthScale;
    if (widthScaledHeight <= bounds.maxHeight) {
      scale = widthScale;
      previewWidth = Math.round(effectiveWidth * scale);
      previewHeight = Math.round(widthScaledHeight);
    }
  }
  if (previewHeight < bounds.minHeight) {
    const heightScale = bounds.minHeight / effectiveHeight;
    const heightScaledWidth = effectiveWidth * heightScale;
    if (heightScaledWidth <= bounds.maxWidth) {
      scale = heightScale;
      previewWidth = Math.round(heightScaledWidth);
      previewHeight = Math.round(effectiveHeight * scale);
    }
  }

  return {
    aspectRatio,
    previewWidthPx: Math.min(bounds.maxWidth, Math.max(bounds.minWidth, previewWidth)),
    previewHeightPx: Math.min(bounds.maxHeight, Math.max(bounds.minHeight, previewHeight)),
  };
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return formatMessageTime(date);
}

function resolveBubbleLabel(message: ConversationCanonicalMessage, copy: Required<ChatCopy>): string {
  if (message.role === 'user' || message.role === 'human') {
    return message.senderName || copy.bubbleUserLabel;
  }
  return message.senderName || copy.bubbleAssistantLabel;
}

function resolveMessageAvatar(message: ConversationCanonicalMessage, copy: Required<ChatCopy>): ReactNode {
  const isUser = message.role === 'user' || message.role === 'human';
  const initial = (String(message.senderName || (isUser ? 'U' : 'A')).trim().charAt(0) || (isUser ? 'U' : 'A')).toUpperCase();
  const avatarUrl = message.senderAvatarUrl || null;
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={message.senderName || resolveBubbleLabel(message, copy)}
        className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)]"
      />
    );
  }
  return (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)]',
        isUser
          ? 'bg-[var(--nimi-text-primary)] text-[var(--nimi-text-inverse)]'
          : 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]',
      )}
    >
      {initial}
    </div>
  );
}

function VoiceBubbleContent(props: {
  isPlaying: boolean;
  onPlay: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  playingLabel: string;
  idleLabel: string;
}) {
  return (
    <button type="button" onClick={props.onPlay} onContextMenu={props.onContextMenu} className="flex items-center gap-3 text-left">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-text-primary)_16%,transparent)]">
        {props.isPlaying ? '⏸' : '▶'}
      </span>
      <div className="flex items-end gap-[3px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={`bar-${i}`}
            className="chat-voice-bar w-[3px] rounded-full bg-current"
            style={{
              height: props.isPlaying ? undefined : '4px',
              animation: props.isPlaying
                ? `voice-bar var(--nimi-motion-ambient) var(--nimi-motion-ease-standard) calc(var(--nimi-motion-fast) * ${i}) infinite`
                : 'none',
              minHeight: '4px',
            }}
          />
        ))}
      </div>
      <span className="text-sm">{props.isPlaying ? props.playingLabel : props.idleLabel}</span>
    </button>
  );
}

export type CanonicalMessageBubbleProps = {
  message: ConversationCanonicalMessage;
  avatar?: ReactNode;
  content?: ReactNode;
  accessory?: ReactNode;
  showAvatar?: boolean;
  showTimestamp?: boolean;
  position?: 'single' | 'start' | 'middle' | 'end';
  displayContext?: CanonicalBubbleDisplayContext;
  /** Optional copy overrides merged over the default English strings. */
  copy?: ChatCopy;
  voicePlayingMessageId?: string | null;
  isVoiceTranscriptVisible?: boolean;
  /**
   * When true, skip the role-play `（...）` narration parser and always render
   * text through the plain markdown renderer. Opt-in for non-roleplay surfaces
   * (e.g. advisor chats) where full-width parentheses are ordinary punctuation.
   */
  disableRpContent?: boolean;
  onPlayVoiceMessage?: (message: ConversationCanonicalMessage) => void;
  onVoiceContextMenu?: (message: ConversationCanonicalMessage, event: React.MouseEvent<HTMLButtonElement>) => void;
  onMessageContextMenu?: (message: ConversationCanonicalMessage, event: React.MouseEvent<HTMLDivElement>) => void;
};

export const CanonicalMessageBubble = memo(function CanonicalMessageBubble({
  message,
  avatar,
  content,
  accessory,
  showAvatar = true,
  showTimestamp = true,
  position = 'single',
  displayContext = 'transcript',
  copy,
  voicePlayingMessageId = null,
  isVoiceTranscriptVisible = false,
  disableRpContent = false,
  onPlayVoiceMessage,
  onVoiceContextMenu,
  onMessageContextMenu,
}: CanonicalMessageBubbleProps) {
  const copyResolved = resolveChatCopy(copy);
  const isUser = message.role === 'user' || message.role === 'human';
  const isVoice = message.kind === 'voice';
  const isImage = message.kind === 'image';
  const isVideo = message.kind === 'video';
  const isImagePending = message.kind === 'image-pending';
  const isVideoPending = message.kind === 'video-pending';
  const isStreaming = message.kind === 'streaming';
  const isPlaying = isVoice && voicePlayingMessageId === message.id;
  const isMediaCard = isImage || isVideo || isImagePending || isVideoPending;
  const bubbleShape = bubbleShapeFor(message.role);
  const animationName = entryAnimationFor(message);
  const animationDelayMs = Math.min(Math.max(Number((message.metadata as Record<string, unknown> | undefined)?.beatIndex || 0), 0) * 90, 320);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [videoLoadError, setVideoLoadError] = useState(false);
  const [resolvedMediaSize, setResolvedMediaSize] = useState<{ width: number; height: number } | null>(null);
  const metadata = (message.metadata as Record<string, unknown> | undefined) || {};
  const mediaUri = String(metadata.mediaUrl || metadata.voiceUrl || '').trim();
  const transcriptText = String(metadata.voiceTranscript || '').trim();
  const stageMediaKind: StageMediaPreviewKind | null = isImage
    ? 'image'
    : isVideo
      ? 'video'
      : isImagePending
        ? 'image-pending'
        : isVideoPending
          ? 'video-pending'
          : null;
  const stageMediaMetrics = displayContext === 'stage' && stageMediaKind
    ? resolveCanonicalStageMediaPreviewMetrics({
      kind: stageMediaKind,
      width: Number(metadata.mediaWidth || resolvedMediaSize?.width || 0) || undefined,
      height: Number(metadata.mediaHeight || resolvedMediaSize?.height || 0) || undefined,
    })
    : null;
  const stageMediaFrameStyle: CSSProperties | undefined = stageMediaMetrics
    ? {
      width: `min(100%, ${stageMediaMetrics.previewWidthPx}px)`,
      maxHeight: `${stageMediaMetrics.previewHeightPx}px`,
      aspectRatio: stageMediaMetrics.aspectRatio,
    }
    : undefined;
  const mediaContainerClassName = isMediaCard
    ? displayContext === 'stage'
      ? 'max-w-full'
      : CHAT_BUBBLE_MEDIA_MAX_WIDTH_CLASSNAME
    : CHAT_BUBBLE_MAX_WIDTH_CLASSNAME;

  const closeImagePreview = useCallback(() => {
    setImagePreviewOpen(false);
  }, []);

  const handleOpenImagePreview = useCallback(() => {
    setImagePreviewOpen(true);
  }, []);

  useEffect(() => {
    setImageLoadError(false);
    setVideoLoadError(false);
    setResolvedMediaSize(null);
  }, [message.id, mediaUri]);

  const resolvedAvatar = avatar === undefined
    ? (showAvatar ? resolveMessageAvatar(message, copyResolved) : <span className="h-8 w-8 shrink-0" aria-hidden />)
    : avatar;

  const time = formatTimestamp(message.createdAt);
  const defaultContent = (
    <div className="space-y-1">
      {isVoice ? (
        <VoiceBubbleContent
          isPlaying={isPlaying}
          onPlay={() => onPlayVoiceMessage?.(message)}
          onContextMenu={onVoiceContextMenu ? (event) => onVoiceContextMenu(message, event) : undefined}
          playingLabel={copyResolved.bubbleVoicePlayingLabel}
          idleLabel={copyResolved.bubbleVoiceMessageLabel}
        />
      ) : isImagePending || isVideoPending ? (
        <div className="space-y-3">
          <div
            className={`lc-media-skeleton rounded-[22px] ${displayContext === 'stage' ? 'mx-0' : 'h-[220px] w-[min(420px,70vw)]'}`}
            style={stageMediaFrameStyle}
          />
          <div className="flex items-center gap-2 text-xs text-[var(--nimi-text-secondary)]">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--nimi-border-strong)] border-t-[var(--nimi-action-primary-bg)]" />
            <span>{message.text || (isImagePending ? copyResolved.bubbleGeneratingImageLabel : copyResolved.bubbleGeneratingVideoLabel)}</span>
          </div>
        </div>
      ) : isImage ? (
        mediaUri && !imageLoadError ? (
          <button
            type="button"
            onClick={handleOpenImagePreview}
            aria-label={copyResolved.bubbleOpenImagePreviewLabel}
            className={`group block overflow-hidden ${displayContext === 'stage'
              ? 'bg-[radial-gradient(circle_at_center,_rgba(248,250,252,0.98),_rgba(226,232,240,0.84))]'
              : 'bg-gray-50'}`}
            style={stageMediaFrameStyle}
          >
            <img
              src={mediaUri}
              alt={message.text || copyResolved.bubbleImageLabel}
              className={`transition-transform duration-[var(--nimi-motion-slow)] group-hover:scale-[1.02] ${displayContext === 'stage'
                ? 'h-full w-full object-contain'
                : 'max-h-[360px] w-full object-cover'}`}
              loading="lazy"
              onLoad={(event) => {
                const target = event.currentTarget;
                setResolvedMediaSize({
                  width: target.naturalWidth,
                  height: target.naturalHeight,
                });
              }}
              onError={() => setImageLoadError(true)}
            />
          </button>
        ) : (
          <p className="text-xs italic opacity-70">{String(metadata.mediaError || copyResolved.bubbleImageUnavailableLabel)}</p>
        )
      ) : isVideo ? (
        mediaUri && !videoLoadError ? (
          <video
            src={mediaUri}
            controls
            preload="metadata"
            className={`${displayContext === 'stage'
              ? 'h-full w-full object-contain bg-slate-950'
              : 'max-h-[360px] w-full bg-black'}`}
            style={stageMediaFrameStyle}
            poster={String(metadata.previewUrl || '') || undefined}
            onLoadedMetadata={(event) => {
              const target = event.currentTarget;
              setResolvedMediaSize({
                width: target.videoWidth,
                height: target.videoHeight,
              });
            }}
            onError={() => setVideoLoadError(true)}
          />
        ) : (
          <p className="text-xs italic opacity-70">{String(metadata.mediaError || copyResolved.bubbleVideoUnavailableLabel)}</p>
        )
      ) : isStreaming ? (
        <div className={`space-y-1 ${message.text ? '' : 'italic opacity-70'}`}>
          {message.text ? <MarkdownMessageContent content={message.text} copy={copyResolved} /> : copyResolved.bubbleStreamingLabel}
          <span className="inline-block animate-pulse text-[var(--nimi-action-primary-bg)]">|</span>
        </div>
      ) : !disableRpContent && hasRpContent(message.text) ? (
        <RpMessageContent content={message.text} />
      ) : (
        <MarkdownMessageContent content={message.text} copy={copyResolved} />
      )}
      {isVoice && isVoiceTranscriptVisible && transcriptText ? (
        <div className="mt-2 border-t border-[var(--nimi-border-subtle)] pt-2 text-xs opacity-80">
          {transcriptText}
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <div
        className={cn('chat-msg-entry group flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}
        style={{ animation: `${animationName} var(--nimi-motion-slow) var(--nimi-motion-ease-standard) ${animationDelayMs}ms both` }}
      >
        {resolvedAvatar}
        <div
          className={mediaContainerClassName}
          onContextMenu={onMessageContextMenu ? (event) => onMessageContextMenu(message, event) : undefined}
        >
          {content === undefined ? (
            <div
              className={cn(
                bubbleShape.className,
                CHAT_BUBBLE_TEXT_CLASSNAME,
                isMediaCard
                  ? 'overflow-hidden border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]'
                  : isUser
                    ? 'bg-[var(--nimi-action-primary-bg)] border border-[var(--nimi-action-primary-bg-hover)] px-4 py-2 text-[var(--nimi-action-primary-text)] [&_*]:!text-inherit'
                    : 'border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] px-4 py-2 text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]',
              )}
              style={bubbleShape.style}
            >
              {defaultContent}
            </div>
          ) : content}
          {showTimestamp && time ? (
            <div
              data-canonical-message-timestamp="true"
              className={cn(
                'mt-1 text-[length:var(--nimi-type-overline-size)] leading-4 text-[var(--nimi-text-muted)] opacity-0 transition-opacity duration-[var(--nimi-motion-fast)] group-hover:opacity-100 group-focus-within:opacity-100',
                isUser ? 'text-right' : 'text-left',
              )}
            >
              {time}
            </div>
          ) : null}
          {accessory === undefined ? null : accessory}
        </div>
      </div>

      <Dialog open={imagePreviewOpen && Boolean(mediaUri)} onOpenChange={(open) => { if (!open) closeImagePreview(); }}>
        <DialogContent
          onClose={closeImagePreview}
          overlayClassName="bg-black/70"
          className="flex max-h-[calc(100vh-3rem)] max-w-[calc(100vw-3rem)] items-start justify-center border-0 bg-transparent p-0 shadow-none"
        >
          <DialogTitle className="sr-only">{copyResolved.bubbleImagePreviewTitle}</DialogTitle>
          <IconButton
            onClick={closeImagePreview}
            className="absolute right-3 top-3 z-[1] h-10 w-10 rounded-full bg-black/60 text-2xl text-white shadow-lg hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label={copyResolved.bubbleCloseImagePreviewLabel}
            icon={<span aria-hidden>×</span>}
          />
          {mediaUri ? (
            <img src={mediaUri} alt={message.text || copyResolved.bubbleImageLabel} className="max-h-[calc(100vh-3rem)] max-w-[calc(100vw-3rem)] rounded-2xl object-contain shadow-2xl" />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
});

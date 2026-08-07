import { Component, Suspense, lazy, memo, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle, IconButton, cn } from '@nimiplatform/kit/ui';
import type { ConversationCanonicalMessage } from '../types.js';
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
  return <p className="my-2 whitespace-pre-wrap text-sm leading-[1.7] text-gray-900">{content}</p>;
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

function MarkdownMessageContent({ content }: { content: string }) {
  const fallback = <PlainTextMessageContent content={content} />;
  return (
    <LazyMessageContentBoundary resetKey={`markdown:${content}`} fallback={fallback}>
      <Suspense fallback={fallback}>
        <ChatMarkdownRenderer content={content} appearance="canonical" />
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

function bubbleShapeFor(role: ConversationCanonicalMessage['role'], position: CanonicalMessageBubbleProps['position']): BubbleShape {
  const R = 22; // large corner radius
  const S = 6;  // small directional corner radius
  const isUser = role === 'user' || role === 'human';

  // CSS border-radius order: top-left / top-right / bottom-right / bottom-left
  if (isUser) {
    // User: bottom-right is the directional corner
    return { className: '', style: { borderRadius: `${R}px ${R}px ${S}px ${R}px` } };
  }
  // Agent: bottom-left is the directional corner
  return { className: '', style: { borderRadius: `${R}px ${R}px ${R}px ${S}px` } };
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
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function resolveBubbleLabel(message: ConversationCanonicalMessage): string {
  if (message.role === 'user' || message.role === 'human') {
    return message.senderName || 'You';
  }
  return message.senderName || 'Assistant';
}

function resolveMessageAvatar(message: ConversationCanonicalMessage): ReactNode {
  const isUser = message.role === 'user' || message.role === 'human';
  const initial = (String(message.senderName || (isUser ? 'U' : 'A')).trim().charAt(0) || (isUser ? 'U' : 'A')).toUpperCase();
  const avatarUrl = message.senderAvatarUrl || null;
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={message.senderName || resolveBubbleLabel(message)}
        className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-black/5"
      />
    );
  }
  return (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-black/5',
        isUser
          ? 'bg-slate-700 text-white'
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
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
        {props.isPlaying ? '⏸' : '▶'}
      </span>
      <div className="flex items-end gap-[3px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={`bar-${i}`}
            className="w-[3px] rounded-full bg-current"
            style={{
              height: props.isPlaying ? undefined : '4px',
              animation: props.isPlaying ? `voice-bar 1.2s ease-in-out ${i * 0.15}s infinite` : 'none',
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
  voicePlayingMessageId = null,
  isVoiceTranscriptVisible = false,
  disableRpContent = false,
  onPlayVoiceMessage,
  onVoiceContextMenu,
  onMessageContextMenu,
}: CanonicalMessageBubbleProps) {
  const isUser = message.role === 'user' || message.role === 'human';
  const isVoice = message.kind === 'voice';
  const isImage = message.kind === 'image';
  const isVideo = message.kind === 'video';
  const isImagePending = message.kind === 'image-pending';
  const isVideoPending = message.kind === 'video-pending';
  const isStreaming = message.kind === 'streaming';
  const isPlaying = isVoice && voicePlayingMessageId === message.id;
  const isMediaCard = isImage || isVideo || isImagePending || isVideoPending;
  const bubbleShape = bubbleShapeFor(message.role, position);
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
      : 'max-w-[78%]'
    : 'max-w-[72%]';

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
    ? (showAvatar ? resolveMessageAvatar(message) : <span className="h-8 w-8 shrink-0" aria-hidden />)
    : avatar;

  const time = formatTimestamp(message.createdAt);
  const defaultContent = (
    <div className="space-y-1">
      {isVoice ? (
        <VoiceBubbleContent
          isPlaying={isPlaying}
          onPlay={() => onPlayVoiceMessage?.(message)}
          onContextMenu={onVoiceContextMenu ? (event) => onVoiceContextMenu(message, event) : undefined}
          playingLabel="Playing voice"
          idleLabel="Voice message"
        />
      ) : isImagePending || isVideoPending ? (
        <div className="space-y-3">
          <div
            className={`lc-media-skeleton rounded-[22px] ${displayContext === 'stage' ? 'mx-0' : 'h-[220px] w-[min(420px,70vw)]'}`}
            style={stageMediaFrameStyle}
          />
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-[var(--nimi-action-primary-bg)]" />
            <span>{message.text || (isImagePending ? 'Generating image…' : 'Generating video…')}</span>
          </div>
        </div>
      ) : isImage ? (
        mediaUri && !imageLoadError ? (
          <button
            type="button"
            onClick={handleOpenImagePreview}
            aria-label="Open image preview"
            className={`group block overflow-hidden ${displayContext === 'stage'
              ? 'bg-[radial-gradient(circle_at_center,_rgba(248,250,252,0.98),_rgba(226,232,240,0.84))]'
              : 'bg-gray-50'}`}
            style={stageMediaFrameStyle}
          >
            <img
              src={mediaUri}
              alt={message.text || 'Image'}
              className={`transition-transform duration-300 group-hover:scale-[1.02] ${displayContext === 'stage'
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
          <p className="text-xs italic opacity-70">{String(metadata.mediaError || 'Image unavailable')}</p>
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
          <p className="text-xs italic opacity-70">{String(metadata.mediaError || 'Video unavailable')}</p>
        )
      ) : isStreaming ? (
        <div className={`space-y-1 ${message.text ? '' : 'italic opacity-70'}`}>
          {message.text ? <MarkdownMessageContent content={message.text} /> : 'Streaming…'}
          <span className="inline-block animate-pulse text-[var(--nimi-action-primary-bg)]">|</span>
        </div>
      ) : !disableRpContent && hasRpContent(message.text) ? (
        <RpMessageContent content={message.text} />
      ) : (
        <MarkdownMessageContent content={message.text} />
      )}
      {isVoice && isVoiceTranscriptVisible && transcriptText ? (
        <div className="mt-2 border-t border-gray-200/30 pt-2 text-xs opacity-80">
          {transcriptText}
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <div
        className={cn('chat-msg-entry group flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}
        style={{ animation: `${animationName} 0.32s cubic-bezier(0.2, 0.7, 0.2, 1) ${animationDelayMs}ms both` }}
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
                'text-sm leading-[1.6]',
                isMediaCard
                  ? 'overflow-hidden border border-gray-200 bg-white'
                  : isUser
                    ? 'bg-[var(--nimi-action-primary-bg)] border border-[var(--nimi-action-primary-bg-hover)] px-4 py-2 text-[var(--nimi-action-primary-text)] [&_*]:!text-inherit'
                    : 'border border-white/70 bg-white/80 px-4 py-2 text-slate-800 shadow-[0_4px_16px_rgba(15,23,42,0.05)]',
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
                'mt-1 text-[11px] leading-4 text-slate-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100',
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
          overlayClassName="z-[1000] bg-black/70"
          className="z-[1001] flex max-h-[calc(100vh-3rem)] max-w-[calc(100vw-3rem)] items-start justify-center border-0 bg-transparent p-0 shadow-none"
        >
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          <IconButton
            onClick={closeImagePreview}
            className="absolute right-3 top-3 z-[1] h-10 w-10 rounded-full bg-black/60 text-2xl text-white shadow-lg hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label="Close image preview"
            icon={<span aria-hidden>×</span>}
          />
          {mediaUri ? (
            <img src={mediaUri} alt={message.text || 'Image'} className="max-h-[calc(100vh-3rem)] max-w-[calc(100vw-3rem)] rounded-2xl object-contain shadow-2xl" />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
});

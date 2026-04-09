import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type { ConversationCanonicalMessage } from '../types.js';
import { ChatMarkdownRenderer } from './chat-markdown-renderer.js';
import { RpContentRenderer } from './rp-content-renderer.js';
import { hasRpContent } from '../utils/rp-content-parser.js';

export type CanonicalBubbleDisplayContext = 'transcript' | 'stage';

type StageMediaPreviewKind = 'image' | 'video' | 'image-pending' | 'video-pending';

const DIALOG_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function listDialogFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) {
    return [];
  }
  return Array.from(root.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
    .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
}

type BubbleShape = { className: string; style: CSSProperties };

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
          : 'bg-gradient-to-br from-emerald-500 to-teal-700 text-white',
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
  onPlayVoiceMessage?: (message: ConversationCanonicalMessage) => void;
  onVoiceContextMenu?: (message: ConversationCanonicalMessage, event: React.MouseEvent<HTMLButtonElement>) => void;
};

export function CanonicalMessageBubble({
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
  onPlayVoiceMessage,
  onVoiceContextMenu,
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
  const previewDialogRef = useRef<HTMLDivElement | null>(null);
  const previewCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
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

  const handleOpenImagePreview = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    lastFocusedElementRef.current = event.currentTarget;
    setImagePreviewOpen(true);
  }, []);

  useEffect(() => {
    setImageLoadError(false);
    setVideoLoadError(false);
    setResolvedMediaSize(null);
  }, [message.id, mediaUri]);

  useEffect(() => {
    if (!imagePreviewOpen) {
      return undefined;
    }
    const dialog = previewDialogRef.current;
    const doc = dialog?.ownerDocument || document;
    if (!lastFocusedElementRef.current && doc.activeElement instanceof HTMLElement) {
      lastFocusedElementRef.current = doc.activeElement;
    }
    const focusInitialTarget = () => {
      const initialTarget = previewCloseButtonRef.current || listDialogFocusableElements(dialog)[0] || dialog;
      initialTarget?.focus();
    };
    const focusTimer = window.setTimeout(focusInitialTarget, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeImagePreview();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusables = listDialogFocusableElements(dialog);
      if (focusables.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const activeElement = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
      const first = focusables[0] || null;
      const last = focusables[focusables.length - 1] || null;
      const activeInside = Boolean(activeElement && dialog?.contains(activeElement));
      if (event.shiftKey) {
        if (!activeInside || activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        return;
      }
      if (!activeInside || activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      doc.removeEventListener('keydown', onKeyDown);
      const lastFocused = lastFocusedElementRef.current;
      lastFocusedElementRef.current = null;
      if (lastFocused && doc.contains(lastFocused)) {
        lastFocused.focus();
      }
    };
  }, [closeImagePreview, imagePreviewOpen]);

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
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-emerald-600" />
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
          {message.text ? <ChatMarkdownRenderer content={message.text} appearance="canonical" /> : 'Streaming…'}
          <span className="inline-block animate-pulse text-emerald-600">|</span>
        </div>
      ) : hasRpContent(message.text) ? (
        <RpContentRenderer content={message.text} appearance="canonical" />
      ) : (
        <ChatMarkdownRenderer content={message.text} appearance="canonical" />
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
        className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}
        style={{ animation: `${animationName} 0.32s cubic-bezier(0.2, 0.7, 0.2, 1) ${animationDelayMs}ms both` }}
      >
        {resolvedAvatar}
        <div className={mediaContainerClassName}>
          {content === undefined ? (
            <div
              className={cn(
                bubbleShape.className,
                'text-sm leading-[1.6]',
                isMediaCard
                  ? 'overflow-hidden border border-gray-200 bg-white'
                  : isUser
                    ? 'bg-gradient-to-br from-emerald-500 to-teal-500 border border-emerald-400 px-4 py-2 text-white/90 [&_*]:!text-inherit'
                    : 'bg-gray-100/70 px-4 py-2 text-gray-600',
              )}
              style={bubbleShape.style}
            >
              {defaultContent}
            </div>
          ) : content}
          {accessory === undefined ? null : accessory}
        </div>
      </div>

      {imagePreviewOpen && mediaUri ? (
        <div
          ref={previewDialogRef}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-6"
          onClick={closeImagePreview}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          tabIndex={-1}
        >
          <div className="relative flex max-h-full max-w-full items-start justify-center" onClick={(event) => event.stopPropagation()}>
            <button
              ref={previewCloseButtonRef}
              type="button"
              onClick={closeImagePreview}
              className="absolute right-3 top-3 z-[1] inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-2xl text-white shadow-lg transition hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              aria-label="Close image preview"
            >
              <span aria-hidden>×</span>
            </button>
            <img src={mediaUri} alt={message.text || 'Image'} className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl" />
          </div>
        </div>
      ) : null}
    </>
  );
}

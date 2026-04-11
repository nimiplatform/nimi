import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ChatStreamStatus,
  type CanonicalMessageContentSlot,
  type ConversationCanonicalMessage,
} from '@nimiplatform/nimi-kit/features/chat';
import {
  cancelStream,
  getStreamState,
  subscribeStream,
  type StreamState,
} from '../turns/stream-controller';

function normalizeReasoningText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveImageUrls(message: ConversationCanonicalMessage): string[] {
  const metadata = (message.metadata as Record<string, unknown> | undefined) || {};
  const attachmentUrls = Array.isArray(metadata.attachments)
    ? metadata.attachments
      .map((attachment) => (
        attachment && typeof attachment === 'object'
          ? normalizeText((attachment as { url?: unknown }).url)
          : ''
      ))
      .filter(Boolean)
    : [];
  const mediaUrl = normalizeText(metadata.mediaUrl);
  if (attachmentUrls.length > 0) {
    return attachmentUrls;
  }
  return mediaUrl ? [mediaUrl] : [];
}

export function useConversationStreamState(chatId: string | null): StreamState | null {
  const [state, setState] = useState<StreamState | null>(() => (chatId ? getStreamState(chatId) : null));

  useEffect(() => {
    if (!chatId) {
      setState(null);
      return;
    }
    setState(getStreamState(chatId));
    return subscribeStream((updated) => {
      if (updated.chatId === chatId) {
        setState({ ...updated });
      }
    });
  }, [chatId]);

  return state;
}

export function RuntimeReasoningMessageContent(props: {
  message: ConversationCanonicalMessage;
  reasoningText: string;
  reasoningLabel: ReactNode;
}) {
  const paragraphs = props.message.text
    .split(/\n{2,}/u)
    .map((item) => item.trim())
    .filter(Boolean);

  return (
    <div className="space-y-3">
      <details className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,white)] px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-[var(--nimi-text-muted)]">
          {props.reasoningLabel}
        </summary>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-[var(--nimi-text-secondary)]">
          {props.reasoningText}
        </pre>
      </details>
      {paragraphs.length > 0 ? (
        <div className="space-y-2">
          {paragraphs.map((paragraph, index) => (
            <p key={`${props.message.id}-paragraph-${index}`} className="whitespace-pre-wrap">
              {paragraph}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RuntimeImageMessageContent(props: {
  message: ConversationCanonicalMessage;
  imageLabel: string;
  showCaptionLabel: string;
  hideCaptionLabel: string;
}) {
  const imageUrls = resolveImageUrls(props.message);
  const caption = normalizeText(props.message.text);
  const [captionVisible, setCaptionVisible] = useState(false);
  const toggleCaption = useCallback(() => setCaptionVisible((prev) => !prev), []);
  if (imageUrls.length === 0) {
    return caption ? <p className="whitespace-pre-wrap">{caption}</p> : null;
  }
  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${imageUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {imageUrls.map((url, index) => (
          <div key={`${props.message.id}-image-${index}`} className="relative">
            <img
              src={url}
              alt={props.imageLabel}
              className="max-h-[480px] w-full max-w-[480px] rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] object-cover"
            />
            {caption ? (
              <button
                type="button"
                onClick={toggleCaption}
                className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition hover:bg-black/70"
                aria-label={captionVisible ? props.hideCaptionLabel : props.showCaptionLabel}
                title={captionVisible ? props.hideCaptionLabel : props.showCaptionLabel}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {caption && captionVisible ? (
        <p className="whitespace-pre-wrap text-xs text-[var(--nimi-text-muted)]">{caption}</p>
      ) : null}
    </div>
  );
}

export function createReasoningMessageContentRenderer(reasoningLabel: ReactNode): CanonicalMessageContentSlot {
  return (message) => {
    if (message.role !== 'assistant' && message.role !== 'agent') {
      return undefined;
    }
    const reasoningText = normalizeReasoningText(message.metadata?.reasoningText);
    if (!reasoningText) {
      return undefined;
    }
    return (
      <RuntimeReasoningMessageContent
        message={message}
        reasoningText={reasoningText}
        reasoningLabel={reasoningLabel}
      />
    );
  };
}

export function RuntimeStreamFooter(props: {
  chatId: string;
  assistantName: string;
  assistantAvatarUrl: string | null;
  assistantKind: 'agent' | 'human';
  streamState: StreamState | null;
  optimisticWaiting?: boolean;
  stopLabel: string;
  interruptedLabel: string;
  reasoningLabel: ReactNode;
  waitingLabel?: string;
  showStreamingText?: boolean;
}) {
  if (props.optimisticWaiting && (!props.streamState || props.streamState.phase === 'idle')) {
    return (
      <ChatStreamStatus
        mode="streaming"
        partialText={props.waitingLabel || '...'}
        reasoningText=""
        reasoningLabel={props.reasoningLabel}
      />
    );
  }

  if (props.streamState && (props.streamState.phase === 'waiting' || props.streamState.phase === 'streaming')) {
    const showStreamingText = props.showStreamingText !== false;
    const isPendingFirstBeat = !props.streamState.partialText && !props.streamState.partialReasoningText;
    const visiblePartialText = showStreamingText
      ? (
        props.streamState.partialText
        || (props.streamState.phase === 'waiting'
          ? (props.waitingLabel || '...')
          : '')
      )
      : (
        isPendingFirstBeat
          ? (props.waitingLabel || '...')
          : ''
      );
    const stopIcon = (
      <button
        type="button"
        onClick={() => cancelStream(props.chatId)}
        className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-400 shadow-sm transition-all duration-150 hover:border-red-300 hover:bg-red-50 hover:text-red-500 hover:shadow-md active:scale-95"
        aria-label={props.stopLabel}
        title={props.stopLabel}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
    );
    if (!showStreamingText && !isPendingFirstBeat) {
      return (
        <div className="flex items-center pl-0">
          {stopIcon}
        </div>
      );
    }
    return (
      <ChatStreamStatus
        mode="streaming"
        partialText={visiblePartialText}
        reasoningText={props.streamState.partialReasoningText}
        reasoningLabel={props.reasoningLabel}
        actions={stopIcon}
      />
    );
  }

  if (props.streamState && (props.streamState.phase === 'error' || props.streamState.phase === 'cancelled') && props.streamState.interrupted) {
    return (
      <ChatStreamStatus
        mode="interrupted"
        partialText={props.streamState.partialText}
        reasoningText={props.streamState.partialReasoningText}
        reasoningLabel={props.reasoningLabel}
        errorMessage={props.streamState.errorMessage}
        interruptedSuffix={<span className="ml-1 text-xs text-red-400">[{props.interruptedLabel}]</span>}
      />
    );
  }

  return null;
}

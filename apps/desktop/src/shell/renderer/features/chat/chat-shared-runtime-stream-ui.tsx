import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Tooltip } from '@nimiplatform/kit/ui';
import {
  type CanonicalMessageContentSlot,
  type ConversationCanonicalMessage,
} from '@nimiplatform/kit/features/chat/headless';
export { RuntimeVoiceMessageContent } from './chat-shared-runtime-voice-message-content';

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
  failureMessage?: string | null;
  technicalDetailsLabel?: string;
  retryLabel?: string;
  onRetry?: (() => void) | null;
}) {
  const imageUrls = resolveImageUrls(props.message);
  const caption = normalizeText(props.message.text);
  const metadata = (props.message.metadata as Record<string, unknown> | undefined) || {};
  const failureReasonCode = normalizeText(metadata.imageFailureReasonCode);
  const operationId = normalizeText(metadata.imageOperationId);
  const [captionVisible, setCaptionVisible] = useState(false);
  const toggleCaption = useCallback(() => setCaptionVisible((prev) => !prev), []);
  if (imageUrls.length === 0) {
    if (props.message.status === 'error' || failureReasonCode) {
      return (
        <div role="alert" className="space-y-2 rounded-2xl border border-[var(--nimi-status-danger)]/30 bg-[var(--nimi-surface-card)] p-3">
          <p className="whitespace-pre-wrap text-sm text-[var(--nimi-text-primary)]">
            {normalizeText(props.failureMessage) || caption || 'Image generation failed.'}
          </p>
          {failureReasonCode || operationId ? (
            <details className="text-xs text-[var(--nimi-text-muted)]">
              <summary className="cursor-pointer">{props.technicalDetailsLabel || 'Technical details'}</summary>
              <p className="break-all font-mono text-[10px]">
                {[failureReasonCode, operationId].filter(Boolean).join(' · ')}
              </p>
            </details>
          ) : null}
          {props.onRetry ? (
            <button
              type="button"
              onClick={props.onRetry}
              className="inline-flex min-h-9 items-center rounded-xl border border-[var(--nimi-border-subtle)] px-3 text-xs font-medium text-[var(--nimi-text-primary)] transition hover:bg-[var(--nimi-surface-active)]"
            >
              {props.retryLabel || 'Retry'}
            </button>
          ) : null}
        </div>
      );
    }
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
              <Tooltip content={captionVisible ? props.hideCaptionLabel : props.showCaptionLabel} placement="top">
                <button
                  type="button"
                  onClick={toggleCaption}
                  className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white/80 transition hover:bg-black/70"
                  aria-label={captionVisible ? props.hideCaptionLabel : props.showCaptionLabel}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </button>
              </Tooltip>
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

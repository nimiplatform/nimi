import React, { useCallback, useEffect, useRef, useState, type ReactNode, type CompositionEvent } from 'react';
import { cn, InlineAlert } from '@nimiplatform/kit/ui';
import { useChatComposer, type UseChatComposerOptions } from '../hooks/use-chat-composer.js';
import { resolveChatCopy, type ChatCopy } from '../copy.js';
import type {
  ChatComposerAttachmentsSlot,
  ChatComposerLayout,
  ChatComposerVoiceState,
  ChatComposerMediaAction,
} from '../types.js';

const MIN_TEXTAREA_HEIGHT = 36;
const MAX_TEXTAREA_HEIGHT = 128;

const ICON_MIC = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1v11" /><path d="M8 5a4 4 0 0 1 8 0v7a4 4 0 0 1-8 0z" />
    <path d="M19 11a7 7 0 0 1-14 0" /><path d="M12 19v4" /><path d="M8 23h8" />
  </svg>
);

const ICON_PLUS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" /><path d="M5 12h14" />
  </svg>
);

const ICON_SEND = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

export type ChatComposerProps<TAttachment = never> = UseChatComposerOptions<TAttachment> & {
  placeholder?: string;
  className?: string;
  toolbar?: ReactNode;
  toolbarSlot?: ReactNode;
  /** Optional slot rendered in the trailing controls row, directly before the send button (stacked layout). */
  trailingSlot?: ReactNode;
  intentLabel?: ReactNode;
  sendHint?: ReactNode;
  sendLabel?: string;
  attachLabel?: string;
  attachmentsSlot?: ChatComposerAttachmentsSlot<TAttachment>;
  /** When provided, the voice button becomes interactive with state-driven rendering. */
  voiceState?: ChatComposerVoiceState;
  /** Quick-action pill buttons for media prompt injection (image/video generation, etc.). */
  mediaActions?: readonly ChatComposerMediaAction[];
  /** Optional slot rendered at the leading edge of the input controls row (before the voice button). */
  leadingSlot?: ReactNode;
  layout?: ChatComposerLayout;
  /** Optional copy overrides merged over the default English strings. */
  copy?: ChatCopy;
};

export function ChatComposer<TAttachment = never>({
  placeholder = 'Type a message...',
  className,
  intentLabel,
  sendHint,
  sendLabel = 'Send',
  attachLabel = 'Attach',
  toolbarSlot,
  trailingSlot,
  attachmentsSlot,
  voiceState,
  mediaActions,
  leadingSlot,
  layout = 'inline',
  copy,
  ...options
}: ChatComposerProps<TAttachment>) {
  const state = useChatComposer(options);
  const copyResolved = resolveChatCopy(copy);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastHeightRef = useRef(MIN_TEXTAREA_HEIGHT);
  const [showMediaActions, setShowMediaActions] = useState(false);

  const composingRef = useRef(false);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, MIN_TEXTAREA_HEIGHT), MAX_TEXTAREA_HEIGHT);
    lastHeightRef.current = next;
    el.style.height = `${next}px`;
  }, []);

  useEffect(() => {
    if (!composingRef.current) {
      resizeTextarea();
    }
  }, [state.text, resizeTextarea]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    state.handleTextChange(e);
  }, [state.handleTextChange]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback((e: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    resizeTextarea();
  }, [resizeTextarea]);

  const renderDefaultAttachments = useCallback(() => {
    if (!options.attachmentAdapter || state.attachments.length === 0) {
      return null;
    }
    return (
      <div className="flex flex-wrap gap-2.5">
        {state.attachments.map((attachment, index) => {
          const key = options.attachmentAdapter?.getKey?.(attachment, index) || `${index}`;
          const label = options.attachmentAdapter?.getLabel?.(attachment, index) || '';
          const secondaryLabel = options.attachmentAdapter?.getSecondaryLabel?.(attachment, index);
          const previewUrl = options.attachmentAdapter?.getPreviewUrl?.(attachment, index);
          const kind = options.attachmentAdapter?.getKind?.(attachment, index);
          return (
            <div
              key={key}
              className="flex min-w-[152px] max-w-[220px] items-center gap-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,transparent)] px-3 py-3 shadow-[var(--nimi-elevation-raised)]"
            >
              {previewUrl && kind === 'image' ? (
                <img
                  src={previewUrl}
                  alt={label || `attachment-${index + 1}`}
                  className="h-12 w-12 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--nimi-surface-panel)] text-[length:var(--nimi-type-overline-size)] font-semibold uppercase tracking-[0.08em] text-[var(--nimi-text-muted)]">
                  {kind === 'video' ? 'VID' : 'FILE'}
                </div>
              )}
              <div className="min-w-0 flex-1">
                {label ? (
                  <div className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{label}</div>
                ) : null}
                {secondaryLabel ? (
                  <div className="truncate text-xs text-[var(--nimi-text-muted)]">{secondaryLabel}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => state.removeAttachment(index)}
                className="rounded-full p-1 text-[var(--nimi-text-muted)] transition-colors hover:text-[var(--nimi-text-secondary)]"
                aria-label={`Remove attachment ${label || index + 1}`}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    );
  }, [options.attachmentAdapter, state.attachments, state.removeAttachment]);

  // Close media actions on successful submit
  const originalHandleSubmit = state.handleSubmit;
  const wrappedHandleSubmit = useCallback(async () => {
    setShowMediaActions(false);
    await originalHandleSubmit();
  }, [originalHandleSubmit]);

  const hasAttachmentControl = Boolean(options.attachmentAdapter || (mediaActions && mediaActions.length > 0));
  const hasMeta = Boolean(intentLabel || sendHint);
  const isStacked = layout === 'stacked';

  const textareaNode = (
    <textarea
      ref={(el) => {
        (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
        if (state.textareaRef) {
          (state.textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
        }
      }}
      rows={1}
      data-chat-composer-textarea="true"
      className={cn(
        'min-h-[36px] max-h-32 min-w-0 flex-1 resize-none overflow-y-hidden',
        isStacked
          ? 'w-full rounded-[var(--nimi-radius-xl)] border-0 bg-transparent px-2.5 py-2 text-[length:var(--nimi-type-body-sm-size)] leading-5 shadow-none'
          : 'rounded-[var(--nimi-radius-xl)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-4 py-3 text-sm',
        'text-[var(--nimi-field-text)] outline-none',
        'transition-colors duration-[var(--nimi-motion-base)]',
        'placeholder:text-[var(--nimi-field-placeholder)]',
        isStacked ? 'focus:ring-0' : 'focus:border-[var(--nimi-field-focus)]',
        isStacked ? 'disabled:bg-transparent' : 'disabled:bg-[var(--nimi-surface-panel)]',
      )}
      placeholder={placeholder}
      aria-label={placeholder}
      value={state.text}
      onChange={handleChange}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onKeyDown={state.handleKeyDown}
      disabled={options.disabled || state.isSubmitting}
      style={{ height: `${lastHeightRef.current}px` }}
    />
  );

  const sendButtonNode = (
    <button
      type="submit"
      disabled={!state.canSubmit}
      aria-label={sendLabel}
      data-chat-composer-send="true"
      className={cn(
        'flex shrink-0 items-center justify-center transition-[background-color,color,box-shadow,transform,opacity] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)]',
        isStacked
          ? 'h-8 w-8 rounded-full bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)] enabled:bg-[var(--nimi-action-primary-bg)] enabled:text-[var(--nimi-action-primary-text)] enabled:shadow-[0_8px_20px_color-mix(in_srgb,var(--nimi-action-primary-bg)_28%,transparent)] enabled:hover:bg-[var(--nimi-action-primary-bg-hover)] enabled:hover:shadow-[0_12px_24px_color-mix(in_srgb,var(--nimi-action-primary-bg)_34%,transparent)]'
          : 'h-12 w-12 rounded-[var(--nimi-radius-xl)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-[0_18px_36px_color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,transparent)] transition-[box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale)] enabled:hover:bg-[var(--nimi-action-primary-bg-hover)] enabled:hover:shadow-[0_22px_44px_color-mix(in_srgb,var(--nimi-action-primary-bg)_40%,transparent)] disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0',
        'active:scale-[var(--nimi-motion-pressed-scale)]',
      )}
    >
      {ICON_SEND}
    </button>
  );

  const voiceButtonNode = voiceState ? (
    <VoiceButton
      voiceState={voiceState}
      disabled={options.disabled || state.isSubmitting}
      compact={isStacked}
      cancelLabel={copyResolved.composerCancelLabel}
    />
  ) : null;
  const hasStackedLeadingActions = Boolean(voiceButtonNode || toolbarSlot);

  const attachmentButtonNode = hasAttachmentControl ? (
    <button
      type="button"
      data-chat-composer-attach="true"
      disabled={options.disabled || state.isSubmitting}
      onClick={() => {
        if (options.attachmentAdapter) {
          void state.openAttachmentPicker();
        } else if (mediaActions && mediaActions.length > 0) {
          setShowMediaActions((v) => !v);
        }
      }}
      className={cn(
        'flex shrink-0 items-center justify-center transition-colors',
        isStacked
          ? 'h-8 w-8 rounded-full border border-transparent bg-transparent text-[var(--nimi-text-muted)] hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)] hover:text-[var(--nimi-text-secondary)]'
          : 'h-11 w-11 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,transparent)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-action-primary-bg)]/50 hover:text-[var(--nimi-action-primary-bg)]',
        showMediaActions ? 'border border-[var(--nimi-action-primary-bg)]/50 bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-action-primary-bg)]' : '',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--nimi-border-subtle)] disabled:hover:text-[var(--nimi-text-muted)]',
      )}
      title={attachLabel}
    >
      {ICON_PLUS}
    </button>
  ) : null;

  return (
    <div className={className} data-chat-composer-layout={layout}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void wrappedHandleSubmit();
        }}
      >
        {state.attachments.length > 0 ? (
          <div className="mb-3">
            {attachmentsSlot
              ? (typeof attachmentsSlot === 'function'
                ? attachmentsSlot({
                  attachments: state.attachments,
                  removeAttachment: state.removeAttachment,
                  openAttachmentPicker: state.openAttachmentPicker,
                })
                : attachmentsSlot)
              : renderDefaultAttachments()}
          </div>
        ) : null}

        {/* media quick-action pills */}
        {showMediaActions && mediaActions && mediaActions.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {mediaActions.map((action) => (
              <button
                key={action.kind}
                type="button"
                onClick={() => {
                  action.onAction();
                  setShowMediaActions(false);
                }}
                className="rounded-full border border-[var(--nimi-action-primary-bg)]/40 bg-[var(--nimi-action-ghost-hover)] px-3 py-1 text-[length:var(--nimi-type-overline-size)] font-semibold text-[var(--nimi-action-primary-bg)] transition-colors hover:bg-[var(--nimi-surface-active)]"
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        {isStacked ? (
          <div className="flex flex-col gap-1">
            <div data-chat-composer-textarea-row="true">
              {textareaNode}
            </div>
            <div
              data-chat-composer-toolbar="true"
              data-chat-composer-toolbar-mode="compact-horizontal"
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-1"
            >
              <div
                data-chat-composer-toolbar-leading="true"
                className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1"
              >
                {leadingSlot ? <div className="flex min-w-0 shrink-0 items-center">{leadingSlot}</div> : null}
                {hasStackedLeadingActions ? (
                  <div
                    data-chat-composer-toolbar-actions="true"
                    data-chat-composer-control-surface="flat"
                    className="flex min-w-0 shrink-0 items-center gap-1"
                  >
                    {voiceButtonNode}
                    {toolbarSlot ? (
                      <div data-chat-composer-toolbar-slot="true" className="flex min-w-0 items-center gap-1">
                        {toolbarSlot}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {hasMeta ? (
                  <div
                    data-chat-composer-toolbar-meta="true"
                    className="flex min-w-[88px] flex-1 items-center gap-2 text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]"
                  >
                    {intentLabel ? <span className="min-w-0 truncate">{intentLabel}</span> : null}
                    {sendHint ? <span className="min-w-0 truncate">{sendHint}</span> : null}
                  </div>
                ) : null}
              </div>
              <div
                data-chat-composer-toolbar-trailing="true"
                data-chat-composer-control-surface="flat"
                className="flex shrink-0 items-center justify-end gap-1"
              >
                {attachmentButtonNode}
                {trailingSlot ? (
                  <div data-chat-composer-toolbar-trailing-slot="true" className="flex shrink-0 items-center gap-1">
                    {trailingSlot}
                  </div>
                ) : null}
                {sendButtonNode}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-end gap-2.5">
              {leadingSlot ? <div className="flex items-end">{leadingSlot}</div> : null}
              {voiceState ? (
                <VoiceButton voiceState={voiceState} disabled={options.disabled || state.isSubmitting} cancelLabel={copyResolved.composerCancelLabel} />
              ) : (
                <button
                  type="button"
                  disabled
                  className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                    'border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]',
                  )}
                  title="Voice input"
                >
                  {ICON_MIC}
                </button>
              )}
              {textareaNode}
              {attachmentButtonNode ?? (
                <button
                  type="button"
                  disabled
                  className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                    'border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]',
                  )}
                  title={attachLabel}
                >
                  {ICON_PLUS}
                </button>
              )}
              {sendButtonNode}
            </div>
            {intentLabel || sendHint ? (
              <div className="mt-1.5 flex items-center justify-end gap-3 px-1 text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">
                {intentLabel ? <span>{intentLabel}</span> : null}
                {sendHint ? <span>{sendHint}</span> : null}
              </div>
            ) : null}
          </>
        )}

        {/* error */}
        {state.error ? (
          <InlineAlert tone="danger" className="mt-2 text-xs">
            {state.error}
          </InlineAlert>
        ) : null}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice button — state-driven sub-component
// ---------------------------------------------------------------------------

const ICON_SPINNER = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

function VoiceButton({
  voiceState,
  disabled,
  compact = false,
  cancelLabel = 'Cancel',
}: {
  voiceState: ChatComposerVoiceState;
  disabled?: boolean;
  compact?: boolean;
  cancelLabel?: string;
}) {
  const { status, onToggle, onCancel } = voiceState;
  const isRecording = status === 'recording';
  const isTranscribing = status === 'transcribing';
  const isFailed = status === 'failed';

  return (
    <div className="flex shrink-0 items-center gap-1.5" data-chat-composer-voice="true">
      <button
        type="button"
        disabled={disabled || isTranscribing}
        onClick={onToggle}
        className={cn(
          'flex shrink-0 items-center justify-center transition-colors',
          compact ? 'h-8 w-8 rounded-full' : 'h-11 w-11 rounded-2xl',
          isRecording
            ? 'border border-[var(--nimi-status-danger-soft-border)] bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger)] shadow-[0_4px_12px_color-mix(in_srgb,var(--nimi-status-danger)_16%,transparent)]'
            : isTranscribing
              ? 'border border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning)]'
              : isFailed
                ? 'border border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning)]'
                : compact
                  ? 'border border-transparent bg-transparent text-[var(--nimi-text-muted)] hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)] hover:text-[var(--nimi-text-secondary)]'
                  : 'border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,transparent)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-action-primary-bg)]/50 hover:text-[var(--nimi-action-primary-bg)]',
        )}
        title={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing…' : 'Voice input'}
      >
        {isTranscribing ? ICON_SPINNER : ICON_MIC}
      </button>
      {(isRecording || isTranscribing) && onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          aria-label={isTranscribing ? 'Cancel transcription' : 'Cancel recording'}
          className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-xs font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-panel)]"
        >
          {cancelLabel}
        </button>
      ) : null}
    </div>
  );
}

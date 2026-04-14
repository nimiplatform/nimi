import { useCallback, useEffect, useRef, useState, type ReactNode, type CompositionEvent } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { useChatComposer, type UseChatComposerOptions } from '../hooks/use-chat-composer.js';
import type { ChatComposerAttachmentsSlot, ChatComposerVoiceState, ChatComposerMediaAction } from '../types.js';

const MIN_TEXTAREA_HEIGHT = 48;
const MAX_TEXTAREA_HEIGHT = 128;

const ICON_MIC = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1v11" /><path d="M8 5a4 4 0 0 1 8 0v7a4 4 0 0 1-8 0z" />
    <path d="M19 11a7 7 0 0 1-14 0" /><path d="M12 19v4" /><path d="M8 23h8" />
  </svg>
);

const ICON_PLUS = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  modelLabel?: ReactNode;
  sendHint?: ReactNode;
  sendLabel?: string;
  attachLabel?: string;
  attachmentsSlot?: ChatComposerAttachmentsSlot<TAttachment>;
  /** When provided, the voice button becomes interactive with state-driven rendering. */
  voiceState?: ChatComposerVoiceState;
  /** Quick-action pill buttons for media prompt injection (image/video generation, etc.). */
  mediaActions?: readonly ChatComposerMediaAction[];
};

export function ChatComposer<TAttachment = never>({
  placeholder = 'Type a message...',
  className,
  modelLabel,
  sendHint,
  sendLabel = 'Send',
  attachLabel = 'Attach',
  attachmentsSlot,
  voiceState,
  mediaActions,
  ...options
}: ChatComposerProps<TAttachment>) {
  const state = useChatComposer(options);
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
              className="flex min-w-[152px] max-w-[220px] items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/90 px-3 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.05)]"
            >
              {previewUrl && kind === 'image' ? (
                <img
                  src={previewUrl}
                  alt={label || `attachment-${index + 1}`}
                  className="h-12 w-12 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  {kind === 'video' ? 'VID' : 'FILE'}
                </div>
              )}
              <div className="min-w-0 flex-1">
                {label ? (
                  <div className="truncate text-sm font-medium text-slate-800">{label}</div>
                ) : null}
                {secondaryLabel ? (
                  <div className="truncate text-xs text-slate-500">{secondaryLabel}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => state.removeAttachment(index)}
                className="rounded-full p-1 text-slate-400 transition-colors hover:text-slate-700"
                aria-label={`remove-attachment-${index + 1}`}
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

  return (
    <div className={className}>
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
                className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700 transition-colors hover:bg-sky-100"
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        {/* input controls row */}
        <div className="flex items-end gap-2.5">
          {/* voice button — interactive when voiceState provided, disabled placeholder otherwise */}
          {voiceState ? (
            <VoiceButton voiceState={voiceState} disabled={options.disabled || state.isSubmitting} />
          ) : (
            <button
              type="button"
              disabled
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                'border border-slate-200 bg-slate-100 text-slate-400',
              )}
              title="Voice input"
            >
              {ICON_MIC}
            </button>
          )}

          {/* media / attachment button */}
          <button
            type="button"
            disabled={!options.attachmentAdapter && (!mediaActions || mediaActions.length === 0) || options.disabled || state.isSubmitting}
            onClick={() => {
              if (options.attachmentAdapter) {
                void state.openAttachmentPicker();
              } else if (mediaActions && mediaActions.length > 0) {
                setShowMediaActions((v) => !v);
              }
            }}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
              (options.attachmentAdapter || (mediaActions && mediaActions.length > 0))
                ? showMediaActions
                  ? 'border border-sky-200 bg-sky-50 text-sky-700 transition-colors'
                  : 'border border-slate-200/80 bg-white/90 text-slate-600 transition-colors hover:border-emerald-300 hover:text-teal-700'
                : 'border border-slate-200 bg-slate-100 text-slate-400',
            )}
            title={attachLabel}
          >
            {ICON_PLUS}
          </button>

          {/* textarea */}
          <textarea
            ref={(el) => {
              (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
              if (state.textareaRef) {
                (state.textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
              }
            }}
            rows={1}
            className={cn(
              'min-h-[48px] max-h-32 min-w-0 flex-1 resize-none overflow-y-hidden',
              'rounded-[20px] border border-slate-200 bg-white px-4 py-3',
              'text-sm text-slate-900 outline-none',
              'transition-colors duration-200',
              'placeholder:text-slate-400',
              'focus:border-emerald-300',
              'disabled:bg-slate-100',
            )}
            placeholder={placeholder}
            value={state.text}
            onChange={handleChange}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={state.handleKeyDown}
            disabled={options.disabled || state.isSubmitting}
            style={{ height: `${lastHeightRef.current}px` }}
          />

          {/* send button */}
          <button
            type="submit"
            disabled={!state.canSubmit}
            aria-label={sendLabel}
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px]',
              'bg-gradient-to-br from-emerald-400 via-teal-400 to-emerald-500',
              'text-white',
              'shadow-[0_18px_36px_rgba(78,204,163,0.3)]',
              'transition-all duration-150',
              'hover:-translate-y-px hover:shadow-[0_22px_44px_rgba(78,204,163,0.4)]',
              'active:scale-[0.92]',
              'disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0',
            )}
          >
            {ICON_SEND}
          </button>
        </div>

        {/* bottom bar: model label + send hint */}
        {modelLabel || sendHint ? (
          <div className="mt-1.5 flex items-center justify-end gap-3 px-1 text-[11px] text-slate-400">
            {modelLabel ? <span>{modelLabel}</span> : null}
            {sendHint ? <span>{sendHint}</span> : null}
          </div>
        ) : null}

        {/* error */}
        {state.error ? (
          <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
            {state.error}
          </div>
        ) : null}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice button — state-driven sub-component
// ---------------------------------------------------------------------------

const ICON_SPINNER = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

function VoiceButton({ voiceState, disabled }: { voiceState: ChatComposerVoiceState; disabled?: boolean }) {
  const { status, onToggle, onCancel } = voiceState;
  const isRecording = status === 'recording';
  const isTranscribing = status === 'transcribing';
  const isFailed = status === 'failed';

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        disabled={disabled || isTranscribing}
        onClick={onToggle}
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-colors',
          isRecording
            ? 'border border-rose-200/80 bg-gradient-to-b from-rose-50 to-white text-rose-600 shadow-[0_4px_12px_rgba(244,63,94,0.12)]'
            : isTranscribing
              ? 'border border-amber-200 bg-amber-50 text-amber-600'
              : isFailed
                ? 'border border-amber-200 bg-amber-50 text-amber-600'
                : 'border border-slate-200/80 bg-white/90 text-slate-600 hover:border-emerald-300 hover:text-teal-700',
        )}
        title={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing…' : 'Voice input'}
      >
        {isTranscribing ? ICON_SPINNER : ICON_MIC}
      </button>
      {isRecording && onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}

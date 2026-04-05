import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { useChatComposer, type UseChatComposerOptions } from '../hooks/use-chat-composer.js';
import type { ChatComposerAttachmentsSlot } from '../types.js';

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
};

export function ChatComposer<TAttachment = never>({
  placeholder = 'Type a message...',
  className,
  modelLabel,
  sendHint,
  sendLabel = 'Send',
  attachLabel = 'Attach',
  attachmentsSlot,
  ...options
}: ChatComposerProps<TAttachment>) {
  const state = useChatComposer(options);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastHeightRef = useRef(MIN_TEXTAREA_HEIGHT);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, MIN_TEXTAREA_HEIGHT), MAX_TEXTAREA_HEIGHT);
    lastHeightRef.current = next;
    el.style.height = `${next}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [state.text, resizeTextarea]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    state.handleTextChange(e);
    resizeTextarea();
  }, [state.handleTextChange, resizeTextarea]);

  const handleSendClick = useCallback(() => {
    void state.handleSubmit();
  }, [state]);

  return (
    <div className={className}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void state.handleSubmit();
        }}
      >
        {attachmentsSlot && state.attachments.length > 0 ? (
          <div className="mb-3">
            {typeof attachmentsSlot === 'function'
              ? attachmentsSlot({
                attachments: state.attachments,
                removeAttachment: state.removeAttachment,
                openAttachmentPicker: state.openAttachmentPicker,
              })
              : attachmentsSlot}
          </div>
        ) : null}

        {/* input controls row */}
        <div className="flex items-end gap-2.5">
          {/* voice button (placeholder — disabled) */}
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

          {/* media button (placeholder — disabled) */}
          <button
            type="button"
            disabled={!options.attachmentAdapter || options.disabled || state.isSubmitting}
            onClick={() => {
              void state.openAttachmentPicker();
            }}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
              options.attachmentAdapter
                ? 'border border-slate-200/80 bg-white/90 text-slate-600 transition-colors hover:border-emerald-300 hover:text-teal-700'
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
              'min-h-[48px] max-h-32 min-w-0 flex-1 resize-none',
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
            onKeyDown={state.handleKeyDown}
            disabled={options.disabled || state.isSubmitting}
            style={{ height: `${lastHeightRef.current}px` }}
          />

          {/* send button */}
          <button
            type="button"
            onClick={handleSendClick}
            disabled={!state.canSubmit}
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

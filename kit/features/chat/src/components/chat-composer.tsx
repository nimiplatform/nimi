import type { ReactNode } from 'react';
import { Button, IconButton, Surface, TextareaField } from '@nimiplatform/nimi-kit/ui';
import { useChatComposer, type UseChatComposerOptions } from '../hooks/use-chat-composer.js';
import type { ChatComposerAttachmentsSlot } from '../types.js';

const ATTACH_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49L13.3 2.21a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.82l8.49-8.48" />
  </svg>
);

const SEND_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 2 11 13" />
    <path d="m22 2-7 20-4-9-9-4Z" />
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
  placeholder = 'Type a message',
  className,
  toolbar,
  modelLabel,
  sendHint = 'Enter to send',
  sendLabel = 'Send message',
  attachLabel = 'Attach',
  attachmentsSlot,
  ...options
}: ChatComposerProps<TAttachment>) {
  const state = useChatComposer(options);
  const attachmentAdapter = options.attachmentAdapter;
  const hasAttachments = state.attachments.length > 0;

  const renderedAttachments = (() => {
    if (!hasAttachments) {
      return null;
    }
    if (typeof attachmentsSlot === 'function') {
      return attachmentsSlot({
        attachments: state.attachments,
        removeAttachment: state.removeAttachment,
        openAttachmentPicker: state.openAttachmentPicker,
      });
    }
    if (attachmentsSlot) {
      return attachmentsSlot;
    }
    return (
      <div className="flex flex-wrap gap-2 px-4 pt-3">
        {state.attachments.map((attachment, index) => {
          const key = attachmentAdapter?.getKey?.(attachment, index) || `attachment-${index}`;
          const label = attachmentAdapter?.getLabel?.(attachment, index) || `Attachment ${index + 1}`;
          const secondaryLabel = attachmentAdapter?.getSecondaryLabel?.(attachment, index);
          const previewUrl = attachmentAdapter?.getPreviewUrl?.(attachment, index);
          const kind = attachmentAdapter?.getKind?.(attachment, index) || 'file';
          return (
            <div
              key={key}
              className="flex max-w-[240px] items-center gap-3 rounded-2xl border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] px-3 py-2 text-xs text-[color:var(--nimi-text-secondary)] shadow-[0_6px_20px_rgba(15,23,42,0.06)]"
            >
              {previewUrl ? (
                kind === 'image' ? (
                  <img
                    src={previewUrl}
                    alt={label}
                    className="h-12 w-12 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-xl bg-[color:var(--nimi-surface-panel)]">
                    <video
                      src={previewUrl}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 text-white">
                      <span className="rounded-full bg-black/45 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                        {kind}
                      </span>
                    </div>
                  </div>
                )
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-[color:var(--nimi-text-primary)]">{label}</p>
                {secondaryLabel ? (
                  <p className="mt-1 truncate text-[11px] text-[color:var(--nimi-text-muted)]">{secondaryLabel}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => state.removeAttachment(index)}
                className="shrink-0 text-[color:var(--nimi-text-muted)] transition hover:text-[color:var(--nimi-text-primary)]"
                aria-label={`Remove ${label}`}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    );
  })();

  return (
    <div className={className}>
      <Surface
        as="form"
        tone="panel"
        padding="none"
        onSubmit={(event) => {
          event.preventDefault();
          void state.handleSubmit();
        }}
        className="rounded-2xl border-[color:var(--nimi-border-subtle)] focus-within:border-[color:var(--nimi-field-focus)]"
      >
        {renderedAttachments}
        <div className="flex items-end gap-2 px-4 py-3">
          {attachmentAdapter ? (
            <IconButton
              type="button"
              tone="ghost"
              icon={ATTACH_ICON}
              className="mb-0.5 h-8 w-8 text-[color:var(--nimi-text-secondary)] hover:text-[color:var(--nimi-text-primary)]"
              aria-label={attachLabel}
              title={attachLabel}
              onClick={() => {
                void state.openAttachmentPicker();
              }}
            />
          ) : null}

          <TextareaField
            ref={state.textareaRef}
            value={state.text}
            onChange={state.handleTextChange}
            onKeyDown={state.handleKeyDown}
            disabled={options.disabled || state.isSubmitting}
            placeholder={placeholder}
            rows={1}
            tone="quiet"
            className="flex-1 min-h-0 border-0 bg-transparent px-0 py-0"
            textareaClassName="min-h-6 max-h-[200px] resize-none border-0 bg-transparent px-0 py-0 text-[15px] leading-6 text-[color:var(--nimi-text-primary)] placeholder:text-[color:var(--nimi-text-muted)]"
          />

          <Button
            type="submit"
            tone={state.canSubmit ? 'primary' : 'secondary'}
            size="sm"
            disabled={!state.canSubmit}
            trailingIcon={SEND_ICON}
            className="mb-0.5 rounded-full"
            aria-label={sendLabel}
            title={sendLabel}
          >
            {sendLabel}
          </Button>
        </div>

        <div className="flex items-center gap-3 px-4 pb-3 pt-0">
          {toolbar ? <div className="flex items-center gap-2">{toolbar}</div> : null}
          <div className="ml-auto flex items-center gap-3 text-[11px] text-[color:var(--nimi-text-muted)]">
            {modelLabel ? <span>{modelLabel}</span> : null}
            {sendHint ? <span>{sendHint}</span> : null}
          </div>
        </div>

        {state.error ? (
          <div className="border-t border-[color:var(--nimi-border-subtle)] px-4 py-3 text-xs text-[color:var(--nimi-status-danger)]">
            {state.error}
          </div>
        ) : null}
      </Surface>
    </div>
  );
}

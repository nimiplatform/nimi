import React, { type ReactNode } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import type {
  AttachmentAdapter,
  ChatComposerAdapter,
  ChatComposerAttachmentsSlot,
  ChatComposerLayout,
  ChatComposerVoiceState,
} from '../types.js';
import { ChatComposer } from './chat-composer.js';
import { ConversationComposerShell } from './conversation-composer-shell.js';

export const CANONICAL_COMPOSER_SURFACE_WIDTH_CLASS = 'w-full max-w-[min(1240px,max(320px,calc(100vw-520px)))]';

export type CanonicalComposerProps<TAttachment = never> = {
  adapter: ChatComposerAdapter<TAttachment>;
  initialText?: string;
  text?: string;
  disabled?: boolean;
  placeholder?: string;
  runtimeHint?: string | null;
  mode?: 'stage' | 'chat';
  className?: string;
  toolbarSlot?: ReactNode;
  trailingSlot?: ReactNode;
  sendHint?: ReactNode;
  intentLabel?: ReactNode;
  onInputCaptureText?: (text: string) => void;
  onTextChange?: (text: string) => void;
  attachmentAdapter?: AttachmentAdapter<TAttachment>;
  attachments?: readonly TAttachment[];
  onAttachmentsChange?: (attachments: readonly TAttachment[]) => void;
  attachmentsSlot?: ChatComposerAttachmentsSlot<TAttachment>;
  attachLabel?: string;
  voiceState?: ChatComposerVoiceState;
  layout?: ChatComposerLayout;
  widthClassName?: string;
  widthPositionClassName?: string;
  leadingSlot?: ReactNode;
};

export function CanonicalComposer<TAttachment = never>({
  adapter,
  initialText,
  text,
  disabled,
  placeholder,
  runtimeHint,
  mode = 'chat',
  className,
  toolbarSlot,
  trailingSlot,
  sendHint,
  intentLabel,
  onInputCaptureText,
  onTextChange,
  attachmentAdapter,
  attachments,
  onAttachmentsChange,
  attachmentsSlot,
  attachLabel,
  voiceState,
  layout = 'inline',
  widthClassName = CANONICAL_COMPOSER_SURFACE_WIDTH_CLASS,
  widthPositionClassName = 'mx-auto',
  leadingSlot,
}: CanonicalComposerProps<TAttachment>) {
  return (
    <div className={cn('shrink-0 px-5 pb-5', mode === 'stage' ? 'pt-1' : 'pt-2', className)} data-canonical-composer-root="true">
      <div
        className={cn(widthPositionClassName, widthClassName)}
        data-canonical-composer-width={widthClassName}
        data-canonical-composer-responsive-floor="320"
      >
        {runtimeHint ? (
          <div className="mb-3 rounded-2xl border border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] px-4 py-2 text-sm text-[var(--nimi-status-warning)] shadow-[0_12px_24px_color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)]">
            {runtimeHint}
          </div>
        ) : null}

        <div>
          <ConversationComposerShell className={cn(mode === 'chat' ? 'rounded-[var(--nimi-radius-xl)] transition-[box-shadow,border-color] duration-[var(--nimi-motion-base)] focus-within:border-[var(--nimi-field-focus)]' : '')}>
            <ChatComposer
              adapter={adapter}
              initialText={initialText}
              text={text}
              onTextChange={onTextChange ?? onInputCaptureText}
              disabled={disabled}
              placeholder={placeholder}
              toolbarSlot={toolbarSlot}
              trailingSlot={trailingSlot}
              intentLabel={intentLabel}
              sendHint={sendHint}
              attachmentAdapter={attachmentAdapter}
              attachments={attachments}
              onAttachmentsChange={onAttachmentsChange}
              attachmentsSlot={attachmentsSlot}
              attachLabel={attachLabel}
              voiceState={voiceState}
              layout={layout}
              leadingSlot={leadingSlot}
            />
          </ConversationComposerShell>
        </div>
      </div>
    </div>
  );
}

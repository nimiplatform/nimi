import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type {
  AttachmentAdapter,
  ChatComposerAdapter,
  ChatComposerAttachmentsSlot,
  ChatComposerLayout,
  ChatComposerVoiceState,
} from '../types.js';
import { ChatComposer } from './chat-composer.js';
import { CANONICAL_STAGE_SURFACE_WIDTH_CLASS } from './canonical-conversation-pane.js';
import { ConversationComposerShell } from './conversation-composer-shell.js';

export type CanonicalComposerProps<TAttachment = never> = {
  adapter: ChatComposerAdapter<TAttachment>;
  initialText?: string;
  disabled?: boolean;
  placeholder?: string;
  runtimeHint?: string | null;
  mode?: 'stage' | 'chat';
  className?: string;
  toolbarSlot?: ReactNode;
  sendHint?: ReactNode;
  modelLabel?: ReactNode;
  onInputCaptureText?: (text: string) => void;
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
  disabled,
  placeholder,
  runtimeHint,
  mode = 'chat',
  className,
  toolbarSlot,
  sendHint,
  modelLabel,
  onInputCaptureText,
  attachmentAdapter,
  attachments,
  onAttachmentsChange,
  attachmentsSlot,
  attachLabel,
  voiceState,
  layout = 'inline',
  widthClassName = CANONICAL_STAGE_SURFACE_WIDTH_CLASS,
  widthPositionClassName = 'mx-auto',
  leadingSlot,
}: CanonicalComposerProps<TAttachment>) {
  return (
    <div className={cn('shrink-0 px-5 pb-5', mode === 'stage' ? 'pt-1' : 'pt-2', className)} data-canonical-composer-root="true">
      <div className={cn(widthPositionClassName, widthClassName)} data-canonical-composer-width={widthClassName}>
        {runtimeHint ? (
          <div className="mb-3 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-2 text-sm text-amber-800 shadow-[0_12px_24px_rgba(217,119,6,0.08)]">
            {runtimeHint}
          </div>
        ) : null}

        <div
          onInputCapture={(event) => {
            const target = event.target;
            if (target instanceof HTMLTextAreaElement) {
              onInputCaptureText?.(target.value);
            }
          }}
        >
          <ConversationComposerShell className={cn(mode === 'chat' ? 'rounded-[24px] shadow-[0_18px_42px_rgba(15,23,42,0.06)]' : '')}>
            <ChatComposer
              adapter={adapter}
              initialText={initialText}
              disabled={disabled}
              placeholder={placeholder}
              toolbarSlot={toolbarSlot}
              modelLabel={modelLabel}
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

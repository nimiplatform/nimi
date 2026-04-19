import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type ReactNode } from 'react';
import { CanonicalComposer, type ChatComposerVoiceState } from '@nimiplatform/nimi-kit/features/chat';
import { useTranslation } from 'react-i18next';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { cn } from '@nimiplatform/nimi-kit/ui';
import {
  appendPendingAttachment,
  formatPendingAttachmentSize,
  type PendingAttachment,
} from '../turns/turn-input-attachments';

type AgentComposerHandsFreeState = {
  mode: 'push-to-talk' | 'hands-free';
  status: 'idle' | 'listening' | 'transcribing' | 'failed';
  disabled: boolean;
  onEnter: () => void;
  onExit: () => void;
};

const ICON_HANDS_FREE = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12a8 8 0 0 1 16 0" />
    <path d="M4 12v5a2 2 0 0 0 2 2h2v-7H6a2 2 0 0 0-2 2Z" />
    <path d="M20 12v5a2 2 0 0 1-2 2h-2v-7h2a2 2 0 0 1 2 2Z" />
    <path d="M12 19v2" />
  </svg>
);

const ICON_THINKING = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 18.5c.7.9 1.6 1.5 2.5 1.5s1.8-.6 2.5-1.5" />
    <path d="M8 10.5a4 4 0 1 1 7.1 2.5c-.7.8-1.1 1.5-1.1 2.5H10c0-1-.4-1.7-1.1-2.5A4 4 0 0 1 8 10.5Z" />
    <path d="M10 4.5 9 3" />
    <path d="M14 4.5 15 3" />
    <path d="M5.5 8 4 7.5" />
    <path d="M18.5 8 20 7.5" />
  </svg>
);

function AgentComposerToolbarControls(props: {
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  handsFreeState?: AgentComposerHandsFreeState;
}) {
  const { t } = useTranslation();
  const handsFreeActive = props.handsFreeState?.mode === 'hands-free';
  const handsFreeDisabled = props.handsFreeState ? (!handsFreeActive && props.handsFreeState.disabled) : false;

  return (
    <>
      {props.handsFreeState ? (
        <button
          type="button"
          data-agent-composer-hands-free="true"
          aria-label={handsFreeActive
            ? t('Chat.voiceSessionHandsFreeExit', { defaultValue: 'Exit hands-free' })
            : t('Chat.voiceSessionHandsFreeEnter', { defaultValue: 'Enter hands-free' })}
          title={handsFreeActive
            ? t('Chat.voiceSessionHandsFreeExit', { defaultValue: 'Exit hands-free' })
            : t('Chat.voiceSessionHandsFreeEnter', { defaultValue: 'Enter hands-free' })}
          disabled={handsFreeDisabled}
          onClick={handsFreeActive ? props.handsFreeState.onExit : props.handsFreeState.onEnter}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors',
            handsFreeActive
              ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
              : 'border-slate-200/80 bg-white/90 text-slate-500 hover:border-emerald-300 hover:text-teal-700',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200/80 disabled:hover:text-slate-500',
          )}
        >
          {ICON_HANDS_FREE}
        </button>
      ) : null}
      {props.thinkingState ? (
        <button
          type="button"
          data-agent-composer-thinking="true"
          aria-label={t('Chat.toggleThinking', { defaultValue: 'Toggle thinking' })}
          title={props.thinkingState === 'on'
            ? t('Chat.thinkingTooltipOn', { defaultValue: 'Thinking enabled — click to disable' })
            : props.thinkingState === 'unsupported'
              ? t('Chat.thinkingTooltipUnsupported', { defaultValue: 'Thinking is not supported by the current route' })
              : t('Chat.thinkingTooltipOff', { defaultValue: 'Thinking disabled — click to enable' })}
          disabled={props.thinkingState === 'unsupported'}
          onClick={props.thinkingState === 'unsupported' ? undefined : props.onThinkingToggle}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors',
            props.thinkingState === 'on'
              ? 'border-sky-200 bg-sky-50 text-sky-600'
              : 'border-slate-200/80 bg-white/90 text-slate-500 hover:border-sky-300 hover:text-sky-700',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200/80 disabled:hover:text-slate-500',
          )}
        >
          {ICON_THINKING}
        </button>
      ) : null}
    </>
  );
}

function AgentAttachmentStrip(props: {
  attachments: readonly PendingAttachment[];
  removeAttachment: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      {props.attachments.map((attachment, index) => (
        <div key={`${attachment.previewUrl}-${index}`} className="relative shrink-0">
          <img
            src={attachment.previewUrl}
            alt={attachment.name || t('ChatTimeline.imageMessage', 'Image')}
            className="block h-20 w-20 rounded-xl object-cover"
          />
          <div className="mt-1 max-w-20">
            <p className="truncate text-[11px] font-medium leading-4 text-[var(--nimi-text-primary)]">{attachment.name}</p>
            <p className="text-[10px] leading-4 text-[var(--nimi-text-muted)]">{formatPendingAttachmentSize(attachment.file.size)}</p>
          </div>
          <button
            type="button"
            onClick={() => props.removeAttachment(index)}
            className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-black/85"
            aria-label={t('TurnInput.removeAttachment')}
            title={t('TurnInput.removeAttachment')}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

export function AgentCanonicalComposer(props: {
  composerKey: string;
  initialText: string;
  disabled: boolean;
  placeholder: string;
  pendingAttachments: readonly PendingAttachment[];
  onAttachmentsChange: (attachments: readonly PendingAttachment[]) => void;
  onInputCaptureText: (text: string) => void;
  onSubmit: (input: { text: string; attachments: readonly PendingAttachment[] }) => Promise<void>;
  voiceState?: ChatComposerVoiceState;
  runtimeHint?: string | null;
  leadingSlot?: ReactNode;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  handsFreeState?: AgentComposerHandsFreeState;
  widthClassName?: string;
  widthPositionClassName?: string;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pickerResolverRef = useRef<((attachments: readonly PendingAttachment[] | null) => void) | null>(null);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const attachmentsRef = useRef<readonly PendingAttachment[]>(props.pendingAttachments);

  useEffect(() => {
    attachmentsRef.current = props.pendingAttachments;
  }, [props.pendingAttachments]);

  useEffect(() => () => {
    pickerResolverRef.current?.(null);
  }, []);

  const replaceAttachments = useCallback((nextAttachments: readonly PendingAttachment[]) => {
    const nextUrlSet = new Set(nextAttachments.map((attachment) => attachment.previewUrl));
    for (const attachment of attachmentsRef.current) {
      if (!nextUrlSet.has(attachment.previewUrl)) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    }
    props.onAttachmentsChange(nextAttachments);
  }, [props]);

  const buildIncomingAttachments = useCallback((files: readonly File[]) => {
    let built = [...attachmentsRef.current];
    let hadUnsupported = false;
    for (const file of files) {
      if (!file.type.toLowerCase().startsWith('image/')) {
        hadUnsupported = true;
        continue;
      }
      const next = appendPendingAttachment(built, file, {
        createObjectUrl: (nextFile) => URL.createObjectURL(nextFile),
        revokeObjectUrl: (url) => URL.revokeObjectURL(url),
      });
      if (!next) {
        hadUnsupported = true;
        continue;
      }
      built = next;
    }
    if (hadUnsupported) {
      setFeedback({
        kind: 'warning',
        message: t('Chat.agentAttachmentImageOnly', {
          defaultValue: 'Agent chat currently supports image attachments only.',
        }),
      });
    }
    return built;
  }, [t]);

  const handleAttachmentFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const built = buildIncomingAttachments(files);
    pickerResolverRef.current?.(built.length > 0 ? built : null);
    pickerResolverRef.current = null;
    event.target.value = '';
  }, [buildIncomingAttachments]);

  const attachmentAdapter = useMemo(() => ({
    openPicker: async () => {
      if (props.disabled) {
        return null;
      }
      return await new Promise<readonly PendingAttachment[] | null>((resolve) => {
        pickerResolverRef.current = resolve;
        fileInputRef.current?.click();
      });
    },
    mergeAttachments: (_current: readonly PendingAttachment[], incoming: readonly PendingAttachment[]) => incoming,
    getKey: (attachment: PendingAttachment) => attachment.previewUrl,
    getLabel: (attachment: PendingAttachment) => attachment.name,
    getSecondaryLabel: (attachment: PendingAttachment) => formatPendingAttachmentSize(attachment.file.size),
    getPreviewUrl: (attachment: PendingAttachment) => attachment.previewUrl,
    getKind: () => 'image' as const,
  }), [props.disabled]);

  const handlePasteCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.clipboardData?.items || []);
    const files = items
      .filter((item) => item.kind === 'file' && item.type.toLowerCase().startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file instanceof File);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    const built = buildIncomingAttachments(files);
    replaceAttachments(built);
  }, [buildIncomingAttachments, replaceAttachments]);

  return (
    <div onPasteCapture={handlePasteCapture}>
      {feedback ? (
        <div className="pb-3">
          <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
        </div>
      ) : null}
      <CanonicalComposer
        key={props.composerKey}
        adapter={{
          submit: ({ text, attachments }) => {
            void props.onSubmit({
              text,
              attachments: attachments as readonly PendingAttachment[],
            });
            return Promise.resolve();
          },
        }}
        initialText={props.initialText}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onInputCaptureText={props.onInputCaptureText}
        attachmentAdapter={attachmentAdapter}
        attachments={props.pendingAttachments}
        onAttachmentsChange={replaceAttachments}
        attachmentsSlot={({ attachments, removeAttachment }) => (
          <AgentAttachmentStrip
            attachments={attachments as readonly PendingAttachment[]}
            removeAttachment={removeAttachment}
          />
        )}
        attachLabel={t('Chat.agentAttachImage', { defaultValue: 'Attach image' })}
        runtimeHint={props.runtimeHint}
        voiceState={props.voiceState}
        layout="stacked"
        widthClassName={props.widthClassName}
        widthPositionClassName={props.widthPositionClassName}
        toolbarSlot={(
          <AgentComposerToolbarControls
            thinkingState={props.thinkingState}
            onThinkingToggle={props.onThinkingToggle}
            handsFreeState={props.handsFreeState}
          />
        )}
        leadingSlot={props.leadingSlot}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleAttachmentFileChange}
        className="hidden"
        aria-hidden="true"
      />
    </div>
  );
}

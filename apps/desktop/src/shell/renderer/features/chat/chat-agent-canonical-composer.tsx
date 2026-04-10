import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent } from 'react';
import { CanonicalComposer, type ChatComposerVoiceState } from '@nimiplatform/nimi-kit/features/chat';
import { useTranslation } from 'react-i18next';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import {
  appendPendingAttachment,
  formatPendingAttachmentSize,
  type PendingAttachment,
} from '../turns/turn-input-attachments';

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
          submit: async ({ text, attachments }) => {
            await props.onSubmit({
              text,
              attachments: attachments as readonly PendingAttachment[],
            });
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

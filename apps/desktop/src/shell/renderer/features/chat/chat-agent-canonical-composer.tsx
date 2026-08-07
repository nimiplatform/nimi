import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type ReactNode } from 'react';
import { CanonicalComposer } from '@nimiplatform/kit/features/chat/components/canonical-composer';
import type { ChatComposerVoiceState } from '@nimiplatform/kit/features/chat/types';
import { useTranslation } from 'react-i18next';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import { cn } from '@nimiplatform/kit/ui';
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

type AgentComposerAvatarAction = {
  state: 'not_configured' | 'ready_stopped' | 'running' | 'pending' | 'unavailable';
  onConfigure?: () => void;
  onActivate?: () => Promise<InlineFeedbackState | null | void> | InlineFeedbackState | null | void;
};

const ICON_HANDS_FREE = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12a8 8 0 0 1 16 0" />
    <path d="M4 12v5a2 2 0 0 0 2 2h2v-7H6a2 2 0 0 0-2 2Z" />
    <path d="M20 12v5a2 2 0 0 1-2 2h-2v-7h2a2 2 0 0 1 2 2Z" />
    <path d="M12 19v2" />
  </svg>
);

const ICON_THINKING = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 18.5c.7.9 1.6 1.5 2.5 1.5s1.8-.6 2.5-1.5" />
    <path d="M8 10.5a4 4 0 1 1 7.1 2.5c-.7.8-1.1 1.5-1.1 2.5H10c0-1-.4-1.7-1.1-2.5A4 4 0 0 1 8 10.5Z" />
    <path d="M10 4.5 9 3" />
    <path d="M14 4.5 15 3" />
    <path d="M5.5 8 4 7.5" />
    <path d="M18.5 8 20 7.5" />
  </svg>
);

const ICON_AVATAR = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M6 21a6 6 0 0 1 12 0" />
    <path d="M8.5 8h.01" />
    <path d="M15.5 8h.01" />
  </svg>
);

const ICON_AGENT_CENTER = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="21" x2="14" y1="4" y2="4" />
    <line x1="10" x2="3" y1="4" y2="4" />
    <line x1="21" x2="12" y1="12" y2="12" />
    <line x1="8" x2="3" y1="12" y2="12" />
    <line x1="21" x2="16" y1="20" y2="20" />
    <line x1="12" x2="3" y1="20" y2="20" />
    <line x1="14" x2="14" y1="2" y2="6" />
    <line x1="8" x2="8" y1="10" y2="14" />
    <line x1="16" x2="16" y1="18" y2="22" />
  </svg>
);

const AGENT_COMPOSER_TOOL_BUTTON_CLASS = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors';

function AgentComposerToolbarControls(props: {
  avatarAction?: AgentComposerAvatarAction;
  onAvatarFeedback?: (feedback: InlineFeedbackState) => void;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  handsFreeState?: AgentComposerHandsFreeState;
}) {
  const { t } = useTranslation();
  const handsFreeActive = props.handsFreeState?.mode === 'hands-free';
  const handsFreeDisabled = props.handsFreeState ? (!handsFreeActive && props.handsFreeState.disabled) : false;
  const avatarState = props.avatarAction?.state || 'not_configured';
  const avatarConfigActionState = avatarState === 'not_configured';
  const avatarDisabled = avatarState === 'pending'
    || avatarState === 'unavailable'
    || (avatarConfigActionState ? !props.avatarAction?.onConfigure : !props.avatarAction?.onActivate);
  const avatarLabel = avatarState === 'running'
    ? t('Chat.agentCenterAvatarStop', { defaultValue: 'Stop Avatar' })
    : avatarState === 'ready_stopped'
      ? t('Chat.agentCenterAvatarStart', { defaultValue: 'Start Avatar' })
      : avatarState === 'pending'
        ? t('Chat.agentCenterAvatarUpdating', { defaultValue: 'Updating Avatar' })
        : avatarState === 'unavailable'
          ? t('Chat.agentCenterAvatarLaunchUnavailable', { defaultValue: 'Avatar launch unavailable' })
          : t('Chat.agentCenterConfigureAvatar', { defaultValue: 'Configure Avatar' });
  const avatarTitle = avatarState === 'running'
    ? t('Chat.agentCenterAvatarStopHint', { defaultValue: 'Close the current companion window.' })
    : avatarState === 'ready_stopped'
      ? t('Chat.agentCenterAvatarStartHint', { defaultValue: 'Open this agent in Nimi Avatar.' })
      : avatarState === 'pending'
        ? t('Chat.agentCenterAvatarUpdatingHint', { defaultValue: 'Avatar action is in progress.' })
        : avatarState === 'unavailable'
          ? t('Chat.agentCenterAvatarLaunchUnavailableHint', { defaultValue: 'Avatar is configured, but launch controls are not available yet.' })
          : t('Chat.agentCenterConfigureAvatarHint', { defaultValue: 'Configure Avatar in Agent Center before starting.' });
  const handleAvatarClick = () => {
    if (avatarDisabled) {
      return;
    }
    if (avatarConfigActionState) {
      props.avatarAction?.onConfigure?.();
      return;
    }
    void Promise.resolve(props.avatarAction?.onActivate?.())
      .then((feedback) => {
        if (feedback) {
          props.onAvatarFeedback?.(feedback);
        }
      })
      .catch((error: unknown) => {
        props.onAvatarFeedback?.({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error || ''),
        });
      });
  };

  return (
    <div data-agent-composer-toolbar-groups="true" className="flex min-w-0 items-center gap-1">
      <div data-agent-composer-avatar-group="true" className="flex items-center">
      <button
        type="button"
        data-agent-composer-avatar={avatarState}
        aria-label={avatarLabel}
        title={avatarTitle}
        disabled={avatarDisabled}
        onClick={handleAvatarClick}
        className={cn(
          AGENT_COMPOSER_TOOL_BUTTON_CLASS,
          avatarState === 'running'
            ? 'border-transparent bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)] hover:bg-[var(--nimi-action-primary-bg)]/20 hover:text-[var(--nimi-action-primary-bg-hover)]'
            : avatarState === 'ready_stopped'
              ? 'border-transparent bg-transparent text-slate-500 hover:bg-slate-900/[0.06] hover:text-slate-700'
              : avatarState === 'pending'
                ? 'cursor-wait border-transparent bg-amber-50 text-amber-600 opacity-70'
                : avatarState === 'unavailable'
                  ? 'cursor-not-allowed border-transparent bg-transparent text-slate-400 opacity-60'
            : 'border-transparent bg-transparent text-slate-500 hover:bg-slate-900/[0.06] hover:text-slate-700',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-slate-500',
        )}
      >
        {ICON_AVATAR}
      </button>
      </div>
      <span aria-hidden="true" data-agent-composer-toolbar-divider="true" className="mx-0.5 h-4 w-px bg-slate-200/80" />
      <div data-agent-composer-utility-group="true" className="flex items-center gap-1">
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
            AGENT_COMPOSER_TOOL_BUTTON_CLASS,
            handsFreeActive
              ? 'border-transparent bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)] hover:bg-[var(--nimi-action-primary-bg)]/20 hover:text-[var(--nimi-action-primary-bg-hover)]'
              : 'border-transparent bg-transparent text-slate-500 hover:bg-slate-900/[0.06] hover:text-slate-700',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-slate-500',
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
              ? t('Chat.thinkingTooltipUnavailable', { defaultValue: 'Thinking is not available for this conversation' })
              : t('Chat.thinkingTooltipOff', { defaultValue: 'Thinking disabled — click to enable' })}
          disabled={props.thinkingState === 'unsupported'}
          onClick={props.thinkingState === 'unsupported' ? undefined : props.onThinkingToggle}
          className={cn(
            AGENT_COMPOSER_TOOL_BUTTON_CLASS,
            props.thinkingState === 'on'
              ? 'border-transparent bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)] hover:bg-[var(--nimi-action-primary-bg)]/20 hover:text-[var(--nimi-action-primary-bg-hover)]'
              : 'border-transparent bg-transparent text-slate-500 hover:bg-slate-900/[0.06] hover:text-slate-700',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-slate-500',
          )}
        >
          {ICON_THINKING}
        </button>
      ) : null}
      </div>
    </div>
  );
}

function AgentComposerAgentCenterButton(props: {
  open?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-agent-composer-agent-center="true"
      aria-label={t('Chat.agentCenterTitle', { defaultValue: 'Agent Center' })}
      aria-pressed={Boolean(props.open)}
      title={props.open
        ? t('Chat.agentCenterClose', { defaultValue: 'Close Agent Center' })
        : t('Chat.agentCenterTitle', { defaultValue: 'Agent Center' })}
      onClick={props.onClick}
      className={cn(
        AGENT_COMPOSER_TOOL_BUTTON_CLASS,
        props.open
          ? 'border-transparent bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)] hover:bg-[var(--nimi-action-primary-bg)]/20 hover:text-[var(--nimi-action-primary-bg-hover)]'
          : 'border-transparent bg-transparent text-slate-500 hover:bg-slate-900/[0.06] hover:text-slate-700',
      )}
    >
      {ICON_AGENT_CENTER}
    </button>
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
  avatarAction?: AgentComposerAvatarAction;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  handsFreeState?: AgentComposerHandsFreeState;
  onOpenAgentCenter?: () => void;
  agentCenterOpen?: boolean;
  widthClassName?: string;
  widthPositionClassName?: string;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pickerResolverRef = useRef<((attachments: readonly PendingAttachment[] | null) => void) | null>(null);
  const [composerText, setComposerText] = useState(props.initialText);
  const attachmentsRef = useRef<readonly PendingAttachment[]>(props.pendingAttachments);

  useEffect(() => {
    attachmentsRef.current = props.pendingAttachments;
  }, [props.pendingAttachments]);

  useEffect(() => {
    setComposerText(props.initialText);
  }, [props.composerKey, props.initialText]);

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
      emitFeedbackToast({
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

  const handleComposerTextChange = useCallback((text: string) => {
    setComposerText(text);
    props.onInputCaptureText(text);
  }, [props]);

  const handleComposerSubmit = useCallback(async (input: {
    text: string;
    attachments: readonly unknown[];
  }) => {
    const submittedText = input.text;
    const submittedAttachments = input.attachments as readonly PendingAttachment[];
    setComposerText('');
    props.onInputCaptureText('');
    if (submittedAttachments.length > 0) {
      props.onAttachmentsChange([]);
    }
    try {
      await props.onSubmit({
        text: submittedText,
        attachments: submittedAttachments,
      });
    } catch (error) {
      setComposerText(submittedText);
      props.onInputCaptureText(submittedText);
      if (submittedAttachments.length > 0) {
        props.onAttachmentsChange(submittedAttachments);
      }
      throw error;
    }
  }, [props]);

  return (
    <div onPasteCapture={handlePasteCapture}>
      <CanonicalComposer
        key={props.composerKey}
        adapter={{
          submit: handleComposerSubmit,
        }}
        initialText={props.initialText}
        text={composerText}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onTextChange={handleComposerTextChange}
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
            avatarAction={props.avatarAction}
            onAvatarFeedback={emitFeedbackToast}
            thinkingState={props.thinkingState}
            onThinkingToggle={props.onThinkingToggle}
            handsFreeState={props.handsFreeState}
          />
        )}
        trailingSlot={props.onOpenAgentCenter ? (
          <AgentComposerAgentCenterButton
            open={props.agentCenterOpen}
            onClick={props.onOpenAgentCenter}
          />
        ) : null}
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

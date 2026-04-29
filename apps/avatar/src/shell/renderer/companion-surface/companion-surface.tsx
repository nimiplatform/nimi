// Wave 1 — Companion Surface (always-visible compact stack).
// Per app-shell-contract.md NAV-SHELL-COMPANION-001..010 this surface is mounted
// alongside embodiment-stage when composition state is `ready` or `fixture_active`.
// Three-layer stack: assistant-bubble / status-row / composer. Anchor binding is
// hard-bound to the current launch-selected agent_id + conversation_anchor_id;
// no cross-anchor messages, no trigger-toggle gating.

import { useCallback, type ChangeEvent, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from '../i18n/index.js';
import {
  beginCompanionSubmit,
  collapseCompanionBubble,
  completeCompanionSubmit,
  failCompanionSubmit,
  setCompanionDraft,
  type CompanionAnchorBinding,
  type CompanionState,
} from '../companion-state.js';
import {
  beginVoiceListening,
  beginVoiceTranscribing,
  setVoiceCompanionError,
  setVoiceLevel,
  setVoiceTranscriptSubmitted,
  closeVoiceCompanion,
  type VoiceCompanionState,
} from '../voice-companion-state.js';
import { createAbortError, normalizeText, toErrorMessage } from '../avatar-shell-utils.js';
import type { AvatarShellSettings } from '../settings-state.js';
import type { BootstrapHandle } from '../app-shell/app-bootstrap.js';
import type { AvatarVoiceCaptureSession } from '../voice-capture.js';

export type CompanionSurfaceProps = {
  bootstrapHandle: BootstrapHandle | null;
  binding: CompanionAnchorBinding | null;
  anchorKey: string | null;
  companion: CompanionState;
  voice: VoiceCompanionState;
  shellSettings: AvatarShellSettings;
  setCompanion: (updater: (current: CompanionState) => CompanionState) => void;
  setVoice: (updater: (current: VoiceCompanionState) => VoiceCompanionState) => void;
  voiceCaptureSessionRef: RefObject<AvatarVoiceCaptureSession | null>;
  voiceSubmitAbortRef: RefObject<AbortController | null>;
  beginVoiceOperation: (anchorKey: string | null) => number;
  clearVoiceOperation: (operationId: number, anchorKey: string | null) => void;
  isVoiceOperationCurrent: (operationId: number, anchorKey: string | null) => boolean;
  onSettingsToggle: () => void;
  settingsOpen: boolean;
};

type StatusTone = 'idle' | 'listening' | 'transcribing' | 'pending' | 'replying' | 'interrupted' | 'error' | 'sending';

const STATUS_TONE_KEY: Record<StatusTone, string> = {
  idle: 'Avatar.status.idle',
  listening: 'Avatar.status.listening',
  transcribing: 'Avatar.status.transcribing',
  pending: 'Avatar.status.pending',
  replying: 'Avatar.status.replying',
  interrupted: 'Avatar.status.interrupted',
  error: 'Avatar.status.error',
  sending: 'Avatar.status.sending',
};

function deriveStatus(companion: CompanionState, voice: VoiceCompanionState): StatusTone {
  if (companion.sendState === 'sending') return 'sending';
  if (voice.status === 'listening') return 'listening';
  if (voice.status === 'transcribing') return 'transcribing';
  if (voice.status === 'pending') return 'pending';
  if (voice.status === 'replying') return 'replying';
  if (voice.status === 'interrupted') return 'interrupted';
  if (voice.status === 'error') return 'error';
  return 'idle';
}

export function CompanionSurface(props: CompanionSurfaceProps) {
  const {
    bootstrapHandle,
    binding,
    anchorKey,
    companion,
    voice,
    shellSettings,
    setCompanion,
    setVoice,
    voiceCaptureSessionRef,
    voiceSubmitAbortRef,
    beginVoiceOperation,
    clearVoiceOperation,
    isVoiceOperationCurrent,
    onSettingsToggle,
    settingsOpen,
  } = props;

  const { t } = useTranslation();
  const status = deriveStatus(companion, voice);
  const label = t(STATUS_TONE_KEY[status]);
  const composerDisabled = !bootstrapHandle || !binding || companion.sendState === 'sending';
  const voiceMicDisabled = !bootstrapHandle || !binding || voice.status === 'transcribing' || voice.status === 'pending' || voice.status === 'replying';
  const showCaptions = shellSettings.showVoiceCaptions
    && (voice.status === 'listening' || voice.status === 'transcribing' || voice.status === 'pending' || voice.status === 'replying');

  const submitText = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (composerDisabled || !bootstrapHandle || !binding) return;
      const text = normalizeText(companion.draft);
      if (!text) return;
      const submittedAt = new Date().toISOString();
      setCompanion((current) => beginCompanionSubmit(current, { text, at: submittedAt }));
      void bootstrapHandle
        .requestTextTurn({
          agentId: binding.agentId,
          conversationAnchorId: binding.conversationAnchorId,
          text,
        })
        .then(() => {
          setCompanion((current) => completeCompanionSubmit(current));
        })
        .catch((error: unknown) => {
          setCompanion((current) =>
            failCompanionSubmit(current, { message: toErrorMessage(error), draft: text }),
          );
        });
    },
    [bootstrapHandle, binding, companion.draft, composerDisabled, setCompanion],
  );

  const onComposerKey = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const form = event.currentTarget.form;
        if (form) {
          form.requestSubmit();
        }
      }
    },
    [],
  );

  const onMicClick = useCallback(() => {
    if (voiceMicDisabled || !bootstrapHandle || !binding) return;

    if (voice.status === 'listening') {
      const activeSession = voiceCaptureSessionRef.current;
      if (!activeSession) {
        setVoice((current) => setVoiceCompanionError(current, t('Avatar.status.voice_capture_inactive_error')));
        return;
      }
      const operationAnchorKey = anchorKey;
      const operationId = beginVoiceOperation(operationAnchorKey);
      voiceCaptureSessionRef.current = null;
      setVoice((current) => beginVoiceTranscribing(current));
      const abortController = new AbortController();
      voiceSubmitAbortRef.current = abortController;
      void activeSession
        .stop()
        .then((recording) => {
          if (
            !isVoiceOperationCurrent(operationId, operationAnchorKey)
            || abortController.signal.aborted
          ) {
            throw createAbortError();
          }
          return bootstrapHandle.submitVoiceCaptureTurn({
            agentId: binding.agentId,
            conversationAnchorId: binding.conversationAnchorId,
            audioBytes: recording.bytes,
            mimeType: recording.mimeType,
            language: navigator.language || 'en-US',
            signal: abortController.signal,
          });
        })
        .then((result) => {
          if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) return;
          setVoice((current) =>
            setVoiceTranscriptSubmitted(current, {
              transcript: result.transcript,
              at: new Date().toISOString(),
            }),
          );
        })
        .catch((error: unknown) => {
          if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) return;
          if ((error as Error | null)?.name === 'AbortError') return;
          setVoice((current) => setVoiceCompanionError(current, toErrorMessage(error)));
        })
        .finally(() => {
          if (voiceSubmitAbortRef.current === abortController) {
            voiceSubmitAbortRef.current = null;
          }
          clearVoiceOperation(operationId, operationAnchorKey);
        });
      return;
    }

    setCompanion((current) => ({ ...current, bubbleVisible: true, unread: false }));
    setVoice((current) => beginVoiceListening(current));
    const operationAnchorKey = anchorKey;
    const operationId = beginVoiceOperation(operationAnchorKey);
    void bootstrapHandle
      .startVoiceCapture({
        agentId: binding.agentId,
        conversationAnchorId: binding.conversationAnchorId,
        onLevelChange: (amplitude) => {
          if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) return;
          setVoice((current) => setVoiceLevel(current, amplitude));
        },
      })
      .then((session) => {
        if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) {
          session.cancel();
          return;
        }
        voiceCaptureSessionRef.current = session;
      })
      .catch((error: unknown) => {
        if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) return;
        voiceCaptureSessionRef.current = null;
        clearVoiceOperation(operationId, operationAnchorKey);
        setVoice((current) => setVoiceCompanionError(current, toErrorMessage(error)));
      });
  }, [
    voiceMicDisabled,
    bootstrapHandle,
    binding,
    voice.status,
    voiceCaptureSessionRef,
    voiceSubmitAbortRef,
    setCompanion,
    setVoice,
    anchorKey,
    beginVoiceOperation,
    clearVoiceOperation,
    isVoiceOperationCurrent,
  ]);

  const onInterruptClick = useCallback(() => {
    if (!bootstrapHandle || !binding) return;
    void bootstrapHandle
      .interruptTurn({
        agentId: binding.agentId,
        conversationAnchorId: binding.conversationAnchorId,
        turnId: voice.currentTurnId || undefined,
        reason: 'avatar_voice_interrupt',
      })
      .catch((error: unknown) => {
        setVoice((current) => setVoiceCompanionError(current, toErrorMessage(error)));
      });
  }, [bootstrapHandle, binding, voice.currentTurnId, setVoice]);

  const onBubbleClose = useCallback(() => {
    setCompanion((current) => collapseCompanionBubble(current));
    setVoice((current) => closeVoiceCompanion(current));
  }, [setCompanion, setVoice]);

  const draftValue = companion.draft ?? '';
  const latestText = companion.latestAssistantMessage?.text ?? null;
  const showBubble = Boolean(companion.bubbleVisible && latestText);

  return (
    <section
      className={`avatar-companion-surface avatar-companion-surface--${status}`}
      data-testid="avatar-companion-surface"
      aria-label={t('Avatar.shell.companion_aria')}
    >
      {showBubble ? (
        <div className="avatar-companion-surface__bubble" data-testid="avatar-companion-bubble">
          <p className="avatar-companion-surface__bubble-text">{latestText}</p>
          <button
            type="button"
            className="avatar-companion-surface__bubble-close"
            aria-label={t('Avatar.bubble.close_aria')}
            onClick={onBubbleClose}
          >
            ×
          </button>
        </div>
      ) : null}

      <div
        className="avatar-companion-surface__status-row"
        role="toolbar"
        aria-label={t('Avatar.status.toolbar_aria')}
      >
        <button
          type="button"
          className={`avatar-companion-surface__mic avatar-companion-surface__mic--${status}`}
          onClick={onMicClick}
          disabled={voiceMicDisabled}
          aria-pressed={voice.status === 'listening'}
          aria-label={
            voice.status === 'listening'
              ? t('Avatar.status.mic_commit_aria')
              : t('Avatar.status.mic_listen_aria')
          }
          data-testid="avatar-companion-mic"
        >
          <span className="avatar-companion-surface__mic-icon" aria-hidden="true">
            {voice.status === 'listening' ? '◉' : '🎙'}
          </span>
        </button>
        <span className="avatar-companion-surface__status-label" data-testid="avatar-companion-status">{label}</span>
        {voice.status === 'replying' ? (
          <button
            type="button"
            className="avatar-companion-surface__interrupt"
            onClick={onInterruptClick}
            aria-label={t('Avatar.status.interrupt_aria')}
          >
            ⏹
          </button>
        ) : (
          <span className="avatar-companion-surface__speaker" aria-hidden="true">
            {voice.status === 'pending' ? '🔊' : '🔈'}
          </span>
        )}
        <button
          type="button"
          className={`avatar-companion-surface__settings${settingsOpen ? ' avatar-companion-surface__settings--open' : ''}`}
          onClick={onSettingsToggle}
          aria-expanded={settingsOpen}
          aria-controls="avatar-companion-settings-popover"
          aria-label={t('Avatar.status.settings_aria')}
        >
          ⚙
        </button>
      </div>

      {showCaptions && voice.userCaption ? (
        <p className="avatar-companion-surface__caption avatar-companion-surface__caption--user">
          {voice.userCaption.text}
        </p>
      ) : null}
      {showCaptions && voice.assistantCaption ? (
        <p
          className={`avatar-companion-surface__caption avatar-companion-surface__caption--assistant${
            voice.assistantCaption.live ? ' avatar-companion-surface__caption--live' : ''
          }`}
        >
          {voice.assistantCaption.text}
        </p>
      ) : null}
      {voice.errorMessage && voice.status === 'error' ? (
        <p className="avatar-companion-surface__error" role="alert">{voice.errorMessage}</p>
      ) : null}
      {companion.sendError ? (
        <p className="avatar-companion-surface__error" role="alert">
          {`${t('Avatar.composer.send_failed_prefix')}: ${companion.sendError}`}
        </p>
      ) : null}

      <form
        className="avatar-companion-surface__composer"
        onSubmit={submitText}
        data-testid="avatar-companion-composer"
      >
        <textarea
          className="avatar-companion-surface__composer-input"
          value={draftValue}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            setCompanion((current) => setCompanionDraft(current, event.target.value));
          }}
          onKeyDown={onComposerKey}
          rows={1}
          maxLength={400}
          placeholder={t('Avatar.composer.placeholder')}
          disabled={composerDisabled}
          aria-label={t('Avatar.composer.aria_label')}
        />
        <button
          type="submit"
          className="avatar-companion-surface__composer-send"
          disabled={composerDisabled || !normalizeText(draftValue)}
          aria-label={t('Avatar.composer.send_aria')}
        >
          ➤
        </button>
      </form>
    </section>
  );
}

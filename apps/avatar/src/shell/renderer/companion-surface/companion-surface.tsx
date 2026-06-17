// Companion Surface: stage-first presence capsule + optional cue/tray.
// The surface is mounted alongside embodiment-stage for ready/fixture_active,
// but only the compact presence capsule is visible by default.

import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import {
  LoaderCircle,
  MessageCircle,
  Mic,
  MicOff,
  Send,
  Settings,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { IconButton, TextareaField, cn } from '@nimiplatform/kit/ui';
import { useTranslation } from '../i18n/index.js';
import {
  beginCompanionSubmit,
  collapseCompanionBubble,
  completeCompanionSubmit,
  dismissCompanionInput,
  failCompanionSubmit,
  openCompanionInput,
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
import { recordAvatarEvidenceEventually } from '../app-shell/avatar-evidence.js';
import { assertAcceptedCompanionParticipationProjection } from '../companion-participation-projection.js';
import {
  derivePresenceState,
  type PresenceState,
} from './presence-state-machine.js';

export type CompanionSurfaceProps = {
  bootstrapHandle: BootstrapHandle | null;
  binding: CompanionAnchorBinding | null;
  anchorKey: string | null;
  companion: CompanionState;
  voice: VoiceCompanionState;
  shellSettings: AvatarShellSettings;
  // composition state at mount time. Required so surface evidence carries the
  // correct posture annotation (`ready` vs `fixture_active`).
  compositionState: string;
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

type CompanionSurfaceStyle = CSSProperties & {
  '--avatar-voice-level'?: string;
};

const ICON_SIZE = 16;

function micIconFor(presence: PresenceState) {
  if (presence.micIntent === 'commit_listening') {
    return <Square size={ICON_SIZE} aria-hidden="true" />;
  }
  if (presence.tone === 'transcribing' || presence.tone === 'pending' || presence.tone === 'sending') {
    return <LoaderCircle size={ICON_SIZE} aria-hidden="true" className="avatar-companion-surface__icon--spin" />;
  }
  if (presence.tone === 'error' || presence.tone === 'blocked') {
    return <MicOff size={ICON_SIZE} aria-hidden="true" />;
  }
  return <Mic size={ICON_SIZE} aria-hidden="true" />;
}

export function CompanionSurface(props: CompanionSurfaceProps) {
  const {
    bootstrapHandle,
    binding,
    anchorKey,
    companion,
    voice,
    shellSettings,
    compositionState,
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
  const presence = derivePresenceState({
    companion,
    voice,
    bootstrapReady: Boolean(bootstrapHandle),
    bindingPresent: Boolean(binding),
    compositionReady: compositionState === 'ready' || compositionState === 'fixture_active',
  });
  const previousPresenceRef = useRef<{
    stateId: PresenceState['stateId'];
    privacyIndicator: PresenceState['privacyIndicator'];
  } | null>(null);
  const label = t(presence.labelKey);
  const draftValue = companion.draft ?? '';
  const composerExpanded = companion.inputVisible || companion.sendState === 'sending' || Boolean(companion.sendError);
  const composerDisabled = !bootstrapHandle || !binding || companion.sendState === 'sending';
  const voiceMicDisabled = presence.micDisabled;
  const showCaptions = shellSettings.showVoiceCaptions
    && presence.captionsVisible;
  const cueText = normalizeText(
    (voice.status === 'replying' || voice.assistantCaption?.live)
      ? voice.assistantCaption?.text
      : companion.latestAssistantMessage?.text,
  );
  const showCue = Boolean(companion.bubbleVisible && cueText);
  const audioActive = presence.audioActive;
  const audioUnavailable = presence.audioUnavailable;
  const levelPercent = `${Math.round(Math.max(0, Math.min(1, voice.level)) * 100)}%`;
  const rootStyle: CompanionSurfaceStyle = {
    '--avatar-voice-level': levelPercent,
  };

  useEffect(() => {
    const previous = previousPresenceRef.current;
    if (!previous || previous.stateId !== presence.stateId) {
      recordAvatarEvidenceEventually({
        kind: 'avatar.audio.lifecycle.state_changed',
        detail: {
          from_state: previous?.stateId ?? null,
          to_state: presence.stateId,
          voice_status: voice.status,
          audio_playback_state: voice.audioPlaybackState,
          lipsync_active: voice.lipsyncActive,
          changed_at: new Date().toISOString(),
        },
      });
    }
    if (!previous || previous.privacyIndicator !== presence.privacyIndicator) {
      recordAvatarEvidenceEventually({
        kind: 'avatar.audio.privacy.indicator_changed',
        detail: {
          indicator: presence.privacyIndicator,
          visible: presence.privacyIndicator !== 'none',
          foreground_only: true,
          changed_at: new Date().toISOString(),
        },
      });
    }
    previousPresenceRef.current = {
      stateId: presence.stateId,
      privacyIndicator: presence.privacyIndicator,
    };
  }, [
    presence.stateId,
    presence.privacyIndicator,
    voice.status,
    voice.audioPlaybackState,
    voice.lipsyncActive,
  ]);

  const submitText = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (composerDisabled || !bootstrapHandle || !binding) return;
      const text = normalizeText(companion.draft);
      if (!text) return;
      const submittedAt = new Date().toISOString();
      setCompanion((current) => beginCompanionSubmit(current, { text, at: submittedAt }));
      void bootstrapHandle
        .requestCompanionParticipation({
          agentId: binding.agentId,
          conversationAnchorId: binding.conversationAnchorId,
          text,
        })
        .then((projection) => {
          assertAcceptedCompanionParticipationProjection(projection);
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
      if (event.key === 'Escape' && companion.sendState !== 'sending') {
        event.preventDefault();
        setCompanion((current) => dismissCompanionInput(current));
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const form = event.currentTarget.form;
        if (form) {
          form.requestSubmit();
        }
      }
    },
    [companion.sendState, setCompanion],
  );

  const onTextEntryClick = useCallback(() => {
    setCompanion((current) =>
      current.inputVisible ? dismissCompanionInput(current) : openCompanionInput(current),
    );
  }, [setCompanion]);

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
    t,
  ]);

  const onInterruptClick = useCallback(() => {
    if (!bootstrapHandle || !binding) return;
    void bootstrapHandle
      .interruptActiveTurn({
        agentId: binding.agentId,
        conversationAnchorId: binding.conversationAnchorId,
        turnId: voice.currentTurnId || undefined,
        reason: 'avatar_voice_interrupt',
      })
      .catch((error: unknown) => {
        setVoice((current) => setVoiceCompanionError(current, toErrorMessage(error)));
      });
  }, [bootstrapHandle, binding, voice.currentTurnId, setVoice]);

  const onCueClose = useCallback(() => {
    setCompanion((current) => collapseCompanionBubble(current));
    setVoice((current) => closeVoiceCompanion(current));
  }, [setCompanion, setVoice]);

  const micAriaLabel = presence.micIntent === 'commit_listening'
    ? t('Avatar.status.mic_commit_aria')
    : presence.micIntent === 'disabled'
      ? t('Avatar.status.mic_blocked_aria')
      : t('Avatar.status.mic_listen_aria');
  const textEntryLabel = t('Avatar.composer.aria_label');
  const speakerLabel = audioUnavailable
    ? t('Avatar.status.audio_unavailable')
    : voice.lipsyncActive
      ? t('Avatar.status.replying')
      : t('Avatar.status.idle');

  return (
    <section
      className={cn(
        'avatar-companion-surface',
        `avatar-companion-surface--${presence.tone}`,
        composerExpanded && 'avatar-companion-surface--composer-expanded',
        showCue && 'avatar-companion-surface--cue-visible',
        audioActive && 'avatar-companion-surface--audio-active',
        voice.lipsyncActive && 'avatar-companion-surface--lipsync-active',
      )}
      data-testid="avatar-companion-surface"
      data-presence-state={presence.stateId}
      data-presence-tone={presence.tone}
      data-privacy-indicator={presence.privacyIndicator}
      data-audio-playback-state={voice.audioPlaybackState}
      data-lipsync-active={voice.lipsyncActive ? 'true' : 'false'}
      data-voice-level={levelPercent}
      aria-label={t('Avatar.shell.companion_aria')}
      style={rootStyle}
    >
      {showCue ? (
        <div className="avatar-companion-surface__assistant-cue" data-testid="avatar-companion-bubble">
          <p className="avatar-companion-surface__assistant-cue-text">{cueText}</p>
          <IconButton
            className="avatar-companion-surface__cue-close"
            aria-label={t('Avatar.bubble.close_aria')}
            title={t('Avatar.bubble.close_aria')}
            onClick={onCueClose}
            icon={<X size={ICON_SIZE} aria-hidden="true" />}
            size="sm"
            tone="ghost"
          />
        </div>
      ) : null}

      {showCaptions && voice.userCaption ? (
        <p className="avatar-companion-surface__caption avatar-companion-surface__caption--user">
          {voice.userCaption.text}
        </p>
      ) : null}
      {showCaptions && voice.assistantCaption ? (
        <p
          className={cn(
            'avatar-companion-surface__caption',
            'avatar-companion-surface__caption--assistant',
            voice.assistantCaption.live && 'avatar-companion-surface__caption--live',
          )}
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

      {composerExpanded ? (
        <form
          id="avatar-companion-composer"
          className="avatar-companion-surface__composer-tray"
          onSubmit={submitText}
          data-testid="avatar-companion-composer"
        >
          <TextareaField
            className="avatar-companion-surface__composer-field"
            textareaClassName="avatar-companion-surface__composer-input"
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
            autoFocus
          />
          <IconButton
            type="submit"
            tone="primary"
            size="sm"
            className="avatar-companion-surface__composer-send"
            disabled={composerDisabled || !normalizeText(draftValue)}
            aria-label={t('Avatar.composer.send_aria')}
            title={t('Avatar.composer.send_aria')}
            icon={<Send size={ICON_SIZE} aria-hidden="true" />}
          />
        </form>
      ) : null}

      <div
        className="avatar-companion-surface__presence-capsule"
        role="toolbar"
        aria-label={t('Avatar.status.toolbar_aria')}
        data-testid="avatar-companion-presence-capsule"
      >
        <button
          type="button"
          className={cn('avatar-companion-surface__mic', `avatar-companion-surface__mic--${presence.tone}`)}
          onClick={onMicClick}
          disabled={voiceMicDisabled}
          aria-pressed={voice.status === 'listening'}
          aria-label={micAriaLabel}
          title={micAriaLabel}
          data-testid="avatar-companion-mic"
        >
          <span className="avatar-companion-surface__mic-icon" aria-hidden="true">
            {micIconFor(presence)}
          </span>
          {voice.status === 'listening' ? (
            <span className="avatar-companion-surface__voice-level" aria-hidden="true">
              <span className="avatar-companion-surface__voice-level-fill" />
            </span>
          ) : null}
        </button>
        <span
          className={cn(
            'avatar-companion-surface__privacy-indicator',
            `avatar-companion-surface__privacy-indicator--${presence.privacyIndicator}`,
          )}
          aria-label={t('Avatar.status.privacy_indicator_aria', { state: label })}
          title={t('Avatar.status.privacy_indicator_aria', { state: label })}
          role="status"
        />
        <span className="avatar-companion-surface__status-label" data-testid="avatar-companion-status">{label}</span>
        {presence.interruptVisible ? (
          <IconButton
            className="avatar-companion-surface__interrupt"
            onClick={onInterruptClick}
            aria-label={t('Avatar.status.interrupt_aria')}
            title={t('Avatar.status.interrupt_aria')}
            icon={<Square size={ICON_SIZE} aria-hidden="true" />}
            size="sm"
            tone="ghost"
          />
        ) : (
          <span
            className={cn(
              'avatar-companion-surface__speaker',
              audioActive && 'avatar-companion-surface__speaker--active',
              audioUnavailable && 'avatar-companion-surface__speaker--unavailable',
            )}
            aria-label={speakerLabel}
            title={speakerLabel}
            role="status"
          >
            {audioUnavailable ? <VolumeX size={ICON_SIZE} aria-hidden="true" /> : <Volume2 size={ICON_SIZE} aria-hidden="true" />}
          </span>
        )}
        <IconButton
          className={cn(
            'avatar-companion-surface__text-entry',
            composerExpanded && 'avatar-companion-surface__text-entry--open',
          )}
          onClick={onTextEntryClick}
          aria-expanded={composerExpanded}
          aria-controls="avatar-companion-composer"
          aria-label={textEntryLabel}
          title={textEntryLabel}
          icon={<MessageCircle size={ICON_SIZE} aria-hidden="true" />}
          size="sm"
          tone="ghost"
        />
        <IconButton
          className={cn('avatar-companion-surface__settings', settingsOpen && 'avatar-companion-surface__settings--open')}
          onClick={onSettingsToggle}
          aria-expanded={settingsOpen}
          aria-controls="avatar-companion-settings-popover"
          aria-label={t('Avatar.status.settings_aria')}
          title={t('Avatar.status.settings_aria')}
          icon={<Settings size={ICON_SIZE} aria-hidden="true" />}
          size="sm"
          tone="ghost"
        />
      </div>
    </section>
  );
}

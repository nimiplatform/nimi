import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import {
  Ban,
  Keyboard,
  LoaderCircle,
  Mic,
  MicOff,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { IconButton, cn } from '@nimiplatform/kit/ui';
import type { BootstrapHandle } from '../app-shell/app-bootstrap.js';
import { createAbortError, toErrorMessage } from '../avatar-shell-utils.js';
import type {
  CompanionAnchorBinding,
} from '../companion-state.js';
import { useTranslation } from '../i18n/index.js';
import type { AvatarShellSettings } from '../settings-state.js';
import type { AvatarVoiceCaptureSession } from '../voice-capture.js';
import {
  beginVoicePermissionRequest,
  beginVoiceListening,
  beginVoiceTranscribing,
  cancelVoiceCapture,
  setVoiceCompanionError,
  setVoiceLevel,
  setVoicePermissionBlocked,
  setVoiceTranscriptSubmitted,
  type VoiceCompanionState,
} from '../voice-companion-state.js';
import { derivePresenceState, type PresenceState } from './presence-state-machine.js';

// @nimi-authority: rule.nimi.avatar.embodiment.r077
// @nimi-authority: rule.nimi.avatar.embodiment.r078

export type CompanionSurfaceProps = {
  bootstrapHandle: BootstrapHandle | null;
  binding: CompanionAnchorBinding | null;
  anchorKey: string | null;
  voice: VoiceCompanionState;
  shellSettings: AvatarShellSettings;
  compositionState: string;
  setVoice: (updater: (current: VoiceCompanionState) => VoiceCompanionState) => void;
  voiceCaptureSessionRef: RefObject<AvatarVoiceCaptureSession | null>;
  voiceSubmitAbortRef: RefObject<AbortController | null>;
  beginVoiceOperation: (anchorKey: string | null) => number;
  clearVoiceOperation: (operationId: number, anchorKey: string | null) => void;
  isVoiceOperationCurrent: (operationId: number, anchorKey: string | null) => boolean;
  onExplicitEngage(): void;
  onOpenTextInput(): void;
  onInterruptLocalCleanup(): void;
  onInterruptFailure(message: string): void;
  onClose(): void;
};

const GLASS_REGULAR_SURFACE_CLASS =
  'nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]';
const ICON_SIZE = 16;

type CompanionSurfaceStyle = CSSProperties & {
  '--avatar-voice-level'?: string;
};

type InterruptRequestState = 'idle' | 'pending' | 'failed';

function shortCaption(text: string): string {
  const normalized = text.trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}…`;
}

function micIconFor(presence: PresenceState) {
  if (presence.micIntent === 'commit_listening') {
    return <Square size={ICON_SIZE} aria-hidden="true" />;
  }
  if (presence.tone === 'requesting-permission'
    || presence.tone === 'transcribing' || presence.tone === 'pending') {
    return <LoaderCircle size={ICON_SIZE} aria-hidden="true" className="avatar-companion-surface__icon--spin" />;
  }
  if (presence.tone === 'blocked') {
    return <MicOff size={ICON_SIZE} aria-hidden="true" />;
  }
  return <Mic size={ICON_SIZE} aria-hidden="true" />;
}

function isPermissionDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'NotAllowedError' || error.name === 'SecurityError';
}

export function shouldMountCompanionSurface(voice: VoiceCompanionState): boolean {
  const audioRequiresSurface = voice.audioPlaybackState === 'requested'
    || voice.audioPlaybackState === 'started'
    || voice.audioPlaybackState === 'failed'
    || voice.audioPlaybackState === 'interrupted';
  return voice.panelVisible
    || voice.status !== 'idle'
    || audioRequiresSurface
    || voice.lipsyncActive;
}

export function CompanionSurface(props: CompanionSurfaceProps) {
  const {
    bootstrapHandle,
    binding,
    anchorKey,
    voice,
    shellSettings,
    compositionState,
    setVoice,
    voiceCaptureSessionRef,
    voiceSubmitAbortRef,
    beginVoiceOperation,
    clearVoiceOperation,
    isVoiceOperationCurrent,
    onExplicitEngage,
    onOpenTextInput,
    onInterruptLocalCleanup,
    onInterruptFailure,
    onClose,
  } = props;
  const { t } = useTranslation();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [captureReady, setCaptureReady] = useState(false);
  const [interruptRequest, setInterruptRequest] = useState<InterruptRequestState>('idle');

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    return () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
    };
  }, []);

  useEffect(() => {
    if (voice.status !== 'listening') setCaptureReady(false);
  }, [voice.status]);

  useEffect(() => {
    if (voice.status === 'idle' || voice.status === 'interrupted') {
      setInterruptRequest('idle');
    }
  }, [voice.status, voice.currentTurnId]);

  const presence = derivePresenceState({
    voice,
    bootstrapReady: Boolean(bootstrapHandle),
    bindingPresent: Boolean(binding),
    compositionReady: compositionState === 'ready',
  });
  const label = interruptRequest === 'pending'
    ? t('Avatar.status.interrupt_pending')
    : interruptRequest === 'failed'
      ? t('Avatar.status.interrupt_failed')
      : t(presence.labelKey);
  const levelPercent = `${Math.round(Math.max(0, Math.min(1, voice.level)) * 100)}%`;
  const rootStyle: CompanionSurfaceStyle = { '--avatar-voice-level': levelPercent };
  const audioActive = presence.audioActive;
  const audioUnavailable = presence.audioUnavailable;
  const showCaptions = shellSettings.showVoiceCaptions
    && (
      presence.captionsVisible
      || Boolean(voice.userCaption)
      || Boolean(voice.assistantCaption)
    );
  const voiceInputErrorMessage = useCallback((error: unknown): string => {
    const raw = toErrorMessage(error);
    const record = error && typeof error === 'object'
      ? error as Record<string, unknown>
      : null;
    const code = typeof record?.['code'] === 'string'
      ? record['code']
      : typeof record?.['reasonCode'] === 'string'
        ? record['reasonCode']
        : '';
    return code === 'SDK_LOCAL_APP_INPUT_INVALID' || raw.includes('SDK_LOCAL_APP_INPUT_INVALID')
      ? t('Avatar.status.voice_input_invalid')
      : raw;
  }, [t]);

  const onMicClick = useCallback(() => {
    if (presence.micDisabled || !bootstrapHandle || !binding) return;
    onExplicitEngage();

    if (voice.status === 'listening') {
      const activeSession = voiceCaptureSessionRef.current;
      if (!activeSession || !captureReady) return;
      const operationAnchorKey = anchorKey;
      const operationId = beginVoiceOperation(operationAnchorKey);
      voiceCaptureSessionRef.current = null;
      setCaptureReady(false);
      setVoice((current) => beginVoiceTranscribing(current));
      const abortController = new AbortController();
      voiceSubmitAbortRef.current = abortController;
      void activeSession
        .stop()
        .then((recording) => {
          if (!isVoiceOperationCurrent(operationId, operationAnchorKey)
            || abortController.signal.aborted) {
            throw createAbortError();
          }
          return bootstrapHandle.submitVoiceCaptureTurn({
            agentHandle: binding.agentHandle,
            conversationAnchorId: binding.conversationAnchorId,
            audioBytes: recording.bytes,
            mimeType: recording.mimeType,
            language: navigator.language || 'en-US',
            signal: abortController.signal,
          });
        })
        .then((result) => {
          if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) return;
          setVoice((current) => setVoiceTranscriptSubmitted(current, {
            transcript: result.transcript,
            at: new Date().toISOString(),
          }));
        })
        .catch((error: unknown) => {
          if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) return;
          if ((error as Error | null)?.name === 'AbortError') return;
          setVoice((current) => setVoiceCompanionError(current, voiceInputErrorMessage(error)));
        })
        .finally(() => {
          if (voiceSubmitAbortRef.current === abortController) {
            voiceSubmitAbortRef.current = null;
          }
          clearVoiceOperation(operationId, operationAnchorKey);
        });
      return;
    }

    const operationAnchorKey = anchorKey;
    const operationId = beginVoiceOperation(operationAnchorKey);
    setVoice((current) => beginVoicePermissionRequest(current));
    setCaptureReady(false);
    void bootstrapHandle
      .startVoiceCapture({
        agentHandle: binding.agentHandle,
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
        setCaptureReady(true);
        setVoice((current) => beginVoiceListening(current));
      })
      .catch((error: unknown) => {
        if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) return;
        voiceCaptureSessionRef.current = null;
        clearVoiceOperation(operationId, operationAnchorKey);
        const denied = isPermissionDeniedError(error);
        const message = denied
          ? t('Avatar.status.permission_denied')
          : voiceInputErrorMessage(error);
        setVoice((current) => denied
          ? setVoicePermissionBlocked(current, message)
          : setVoiceCompanionError(current, message));
      });
  }, [
    anchorKey,
    beginVoiceOperation,
    binding,
    bootstrapHandle,
    captureReady,
    clearVoiceOperation,
    isVoiceOperationCurrent,
    onExplicitEngage,
    presence.micDisabled,
    setVoice,
    t,
    voice.status,
    voiceCaptureSessionRef,
    voiceSubmitAbortRef,
    voiceInputErrorMessage,
  ]);

  const onCancelCapture = useCallback(() => {
    if (voice.status !== 'requesting_permission' && voice.status !== 'listening') return;
    const operationId = beginVoiceOperation(anchorKey);
    voiceCaptureSessionRef.current?.cancel();
    voiceCaptureSessionRef.current = null;
    voiceSubmitAbortRef.current?.abort();
    voiceSubmitAbortRef.current = null;
    setCaptureReady(false);
    setVoice((current) => cancelVoiceCapture(current));
    clearVoiceOperation(operationId, anchorKey);
  }, [
    anchorKey,
    beginVoiceOperation,
    clearVoiceOperation,
    setVoice,
    voice.status,
    voiceCaptureSessionRef,
    voiceSubmitAbortRef,
  ]);

  const onInterruptClick = useCallback(() => {
    if (!bootstrapHandle || !binding || interruptRequest === 'pending') return;
    setInterruptRequest('pending');
    onInterruptLocalCleanup();
    void bootstrapHandle.interruptConversationTurn({
      agentHandle: binding.agentHandle,
      conversationAnchorId: binding.conversationAnchorId,
      turnId: voice.currentTurnId || undefined,
      reason: 'avatar_voice_interrupt',
    }).catch((error: unknown) => {
      const message = toErrorMessage(error);
      setInterruptRequest('failed');
      onInterruptFailure(message);
    });
  }, [
    binding,
    bootstrapHandle,
    interruptRequest,
    onInterruptFailure,
    onInterruptLocalCleanup,
    voice.currentTurnId,
  ]);

  const micAriaLabel = presence.micIntent === 'commit_listening'
    ? t('Avatar.status.mic_commit_aria')
    : presence.micIntent === 'disabled'
      ? t('Avatar.status.mic_blocked_aria')
      : t('Avatar.status.mic_listen_aria');

  return (
    <section
      className={cn(
        'avatar-companion-surface',
        `avatar-companion-surface--${presence.tone}`,
        audioActive && 'avatar-companion-surface--audio-active',
        voice.lipsyncActive && 'avatar-companion-surface--lipsync-active',
      )}
      data-testid="avatar-companion-surface"
      data-avatar-interactive-region="true"
      data-presence-state={presence.stateId}
      data-privacy-indicator={presence.privacyIndicator}
      data-audio-playback-state={voice.audioPlaybackState}
      data-lipsync-active={voice.lipsyncActive ? 'true' : 'false'}
      data-caption-size={shellSettings.captionSize}
      data-caption-contrast={shellSettings.captionContrast}
      aria-label={t('Avatar.shell.companion_aria')}
      style={rootStyle}
    >
      {showCaptions && voice.userCaption ? (
        <p className={cn(
          'avatar-companion-surface__caption',
          'avatar-companion-surface__caption--user',
          GLASS_REGULAR_SURFACE_CLASS,
        )} role="status" aria-live="polite">
          {shortCaption(voice.userCaption.text)}
        </p>
      ) : null}
      {showCaptions && voice.assistantCaption ? (
        <p className={cn(
          'avatar-companion-surface__caption',
          'avatar-companion-surface__caption--assistant',
          voice.assistantCaption.live && 'avatar-companion-surface__caption--live',
          GLASS_REGULAR_SURFACE_CLASS,
        )} role="status" aria-live="polite">
          {shortCaption(voice.assistantCaption.text)}
        </p>
      ) : null}
      {voice.status === 'error' && voice.errorMessage ? (
        <p className="avatar-companion-surface__error" role="alert">{voice.errorMessage}</p>
      ) : null}
      <div
        className={cn('avatar-companion-surface__presence-capsule', GLASS_REGULAR_SURFACE_CLASS)}
        role="toolbar"
        aria-label={t('Avatar.status.toolbar_aria')}
        data-testid="avatar-companion-presence-capsule"
      >
        <button
          type="button"
          className={cn('avatar-companion-surface__mic', `avatar-companion-surface__mic--${presence.tone}`)}
          onClick={onMicClick}
          disabled={presence.micDisabled || (voice.status === 'listening' && !captureReady)}
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
        <span
          className="avatar-companion-surface__status-label"
          data-testid="avatar-companion-status"
          role="status"
          aria-live="polite"
        >
          {label}
        </span>
        {presence.interruptVisible ? (
          <IconButton
            className="avatar-companion-surface__interrupt"
            onClick={onInterruptClick}
            disabled={interruptRequest === 'pending'}
            aria-label={t('Avatar.status.interrupt_aria')}
            title={t('Avatar.status.interrupt_aria')}
            icon={interruptRequest === 'pending'
              ? <LoaderCircle size={ICON_SIZE} aria-hidden="true" className="avatar-companion-surface__icon--spin" />
              : <Square size={ICON_SIZE} aria-hidden="true" />}
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
            aria-label={audioUnavailable ? t('Avatar.status.audio_unavailable') : t('Avatar.status.idle')}
            role="status"
          >
            {audioUnavailable
              ? <VolumeX size={ICON_SIZE} aria-hidden="true" />
              : <Volume2 size={ICON_SIZE} aria-hidden="true" />}
          </span>
        )}
        {voice.status === 'requesting_permission' || voice.status === 'listening' ? (
          <IconButton
            className="avatar-companion-surface__cancel"
            onClick={onCancelCapture}
            aria-label={t('Avatar.status.cancel_capture_aria')}
            title={t('Avatar.status.cancel_capture_aria')}
            icon={<Ban size={ICON_SIZE} aria-hidden="true" />}
            size="sm"
            tone="ghost"
          />
        ) : null}
        <IconButton
          className="avatar-companion-surface__text-entry"
          onClick={onOpenTextInput}
          aria-label={t('Avatar.composer.aria_label')}
          title={t('Avatar.composer.aria_label')}
          icon={<Keyboard size={ICON_SIZE} aria-hidden="true" />}
          size="sm"
          tone="ghost"
        />
        <IconButton
          className="avatar-companion-surface__close"
          onClick={onClose}
          disabled={voice.status === 'requesting_permission' || voice.status === 'listening'}
          aria-label={t('Avatar.status.close_aria')}
          title={t('Avatar.status.close_aria')}
          icon={<X size={ICON_SIZE} aria-hidden="true" />}
          size="sm"
          tone="ghost"
        />
      </div>
    </section>
  );
}

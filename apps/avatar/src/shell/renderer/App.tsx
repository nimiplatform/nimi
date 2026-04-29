// Wave 1 — Avatar shell root component.
// Per app-shell-contract.md NAV-SHELL-COMPOSITION-002 the shell mounts exactly
// one of: (embodiment-stage + companion-surface) OR degraded-surface.
// The legacy mixed `recovery panel` + `trigger toggle` paths from Phase 1/2 are
// hard-cut; companion-surface is always-visible while ready.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from './i18n/index.js';
import { bootstrapAvatar, type BootstrapHandle } from './app-shell/app-bootstrap.js';
import { useAvatarStore } from './app-shell/app-store.js';
import { recordAvatarEvidenceEventually } from './app-shell/avatar-evidence.js';
import { setAlwaysOnTop } from './app-shell/tauri-commands.js';
import { isTauriRuntime, onLaunchContextUpdated } from './app-shell/tauri-lifecycle.js';
import { deriveCompositionState, type CompositionDerivation } from './app-shell/composition-state.js';
import { EmbodimentStage } from './embodiment-stage/embodiment-stage.js';
import { CompanionSurface } from './companion-surface/companion-surface.js';
import { DegradedSurface } from './degraded-surface/degraded-surface.js';
import {
  bindCompanionState,
  collapseCompanionBubble,
  createCompanionAnchorKey,
  ingestAssistantMessage,
  initialCompanionState,
  readActiveTurnCue,
  readLatestAssistantMessage,
  readTurnTerminalCue,
  type CompanionAnchorBinding,
} from './companion-state.js';
import {
  activateLipsync,
  bindVoiceCompanionState,
  closeVoiceCompanion,
  completeVoiceReplying,
  deactivateLipsync,
  initialVoiceCompanionState,
  interruptVoiceCompanion,
  setAudioPlaybackState,
  setMouthOpenY,
  setVoiceAssistantCaption,
  setVoiceCompanionAvailability,
  setVoiceReplyingTurn,
} from './voice-companion-state.js';
import { getSharedVoiceLipsyncStateBus } from './voice-lipsync/voice-lipsync-state-bus.js';
import { getSharedAudioPlaybackController } from './audio/audio-playback.js';
import {
  defaultAvatarShellSettings,
  readAvatarShellSettings,
  writeAvatarShellSettings,
  type AvatarShellSettings,
} from './settings-state.js';
import type { AvatarVoiceCaptureSession } from './voice-capture.js';
import { normalizeText, toErrorMessage } from './avatar-shell-utils.js';

export function App() {
  const { t } = useTranslation();
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const [bootstrapHandle, setBootstrapHandle] = useState<BootstrapHandle | null>(null);
  const [companion, setCompanion] = useState(initialCompanionState);
  const [voice, setVoice] = useState(initialVoiceCompanionState);
  const [shellSettings, setShellSettings] = useState<AvatarShellSettings>(() =>
    readAvatarShellSettings(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [interactionModality, setInteractionModality] = useState<'keyboard' | 'pointer'>('pointer');
  const [bodyHovered, setBodyHovered] = useState(false);
  const [bodyPointerContact, setBodyPointerContact] = useState(false);
  const [focusVisibleWithinStage, setFocusVisibleWithinStage] = useState(false);
  const [relaunchPending, setRelaunchPending] = useState(false);

  const voiceCaptureSessionRef = useRef<AvatarVoiceCaptureSession | null>(null);
  const voiceSubmitAbortRef = useRef<AbortController | null>(null);
  const voiceOperationCounterRef = useRef(0);
  const voiceOperationRef = useRef<{ id: number; anchorKey: string | null } | null>(null);
  const currentAnchorKeyRef = useRef<string | null>(null);
  const unmountedRef = useRef(false);

  const bundle = useAvatarStore((s) => s.bundle);
  const shell = useAvatarStore((s) => s.shell);
  const consume = useAvatarStore((s) => s.consume);
  const driver = useAvatarStore((s) => s.driver);
  const runtimeBinding = useAvatarStore((s) => s.runtime.binding);
  const launchContext = useAvatarStore((s) => s.launch.context);

  const persistShellSettings = (next: AvatarShellSettings): void => {
    setShellSettings(next);
    writeAvatarShellSettings(next);
  };

  // ── Bootstrap lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isTauriRuntime()) return;
    recordAvatarEvidenceEventually({
      kind: 'avatar.renderer.boot',
      detail: {
        source: 'avatar-renderer',
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      },
    });
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    let handle: BootstrapHandle | null = null;
    bootstrapAvatar()
      .then((h) => {
        handle = h;
        setBootstrapHandle(h);
        setBootstrapComplete(true);
      })
      .catch((err: unknown) => {
        setBootstrapError(toErrorMessage(err));
      });
    return () => {
      unmountedRef.current = true;
      voiceOperationRef.current = null;
      voiceCaptureSessionRef.current?.cancel();
      voiceCaptureSessionRef.current = null;
      voiceSubmitAbortRef.current?.abort();
      voiceSubmitAbortRef.current = null;
      setBootstrapHandle(null);
      void handle?.shutdown();
    };
  }, []);

  // ── Wave 3 lipsync state subscription ────────────────────────────────────────
  // The avatar-voice-lipsync pipeline (wired from carrier/avatar-carrier.ts)
  // publishes `activate / mouth_open_y / audio_playback_state / deactivate`
  // events into the shared bus; the audio playback controller publishes its
  // own snapshots. We mirror both into voice-companion-state so the companion
  // surface can render mouth + playback indicators in lockstep with Live2D.
  useEffect(() => {
    const bus = getSharedVoiceLipsyncStateBus();
    const audio = getSharedAudioPlaybackController();
    const unsubscribeBus = bus.subscribe((event) => {
      setVoice((current) => {
        switch (event.kind) {
          case 'activate':
            return activateLipsync(current, { audioArtifactId: event.audioArtifactId });
          case 'mouth_open_y':
            return setMouthOpenY(current, event.value);
          case 'audio_playback_state':
            return setAudioPlaybackState(current, event.state);
          case 'deactivate':
            return deactivateLipsync(current);
          default:
            return current;
        }
      });
    });
    const unsubscribeAudio = audio.subscribe((snapshot) => {
      setVoice((current) => setAudioPlaybackState(current, snapshot.state));
    });
    return () => {
      unsubscribeBus();
      unsubscribeAudio();
    };
  }, []);

  // ── Always-on-top settings sync ──────────────────────────────────────────────
  useEffect(() => {
    useAvatarStore.getState().setAlwaysOnTop(shellSettings.alwaysOnTop);
  }, [shellSettings.alwaysOnTop]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void setAlwaysOnTop(shellSettings.alwaysOnTop).catch(() => {
      // Settings are advisory; failure to apply does not flip composition state.
    });
  }, [shellSettings.alwaysOnTop]);

  // ── Interaction modality ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (): void => setInteractionModality('keyboard');
    const handlePointerDown = (): void => {
      setInteractionModality('pointer');
      setFocusVisibleWithinStage(false);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, []);

  // ── Launch context update → relaunch-pending composition state ───────────────
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    void onLaunchContextUpdated((payload) => {
      if (!active) return;
      useAvatarStore.getState().setLaunchContext(payload);
      setRelaunchPending(true);
      voiceCaptureSessionRef.current?.cancel();
      voiceCaptureSessionRef.current = null;
      voiceSubmitAbortRef.current?.abort();
      voiceSubmitAbortRef.current = null;
      setCompanion(initialCompanionState);
      setVoice(initialVoiceCompanionState);
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  // ── Anchor binding (companion + voice) ───────────────────────────────────────
  const companionBinding = useMemo<CompanionAnchorBinding | null>(() => {
    const agentId = normalizeText(consume.agentId);
    const conversationAnchorId = normalizeText(consume.conversationAnchorId);
    if (!agentId || !conversationAnchorId) return null;
    return { agentId, conversationAnchorId };
  }, [consume.agentId, consume.conversationAnchorId]);

  const companionAnchorKey = createCompanionAnchorKey(companionBinding);

  useEffect(() => {
    currentAnchorKeyRef.current = companionAnchorKey;
    voiceOperationRef.current = null;
    voiceCaptureSessionRef.current?.cancel();
    voiceCaptureSessionRef.current = null;
    voiceSubmitAbortRef.current?.abort();
    voiceSubmitAbortRef.current = null;
    setCompanion((current) => bindCompanionState(current, companionBinding));
    setVoice((current) => bindVoiceCompanionState(current, companionBinding));
  }, [companionAnchorKey, companionBinding]);

  // ── Voice availability probe ─────────────────────────────────────────────────
  useEffect(() => {
    if (!bootstrapHandle || !companionBinding) return;
    let cancelled = false;
    setVoice((current) =>
      setVoiceCompanionAvailability(bindVoiceCompanionState(current, companionBinding), {
        availability: 'unknown',
        message: null,
      }),
    );
    void bootstrapHandle
      .getVoiceInputAvailability({
        agentId: companionBinding.agentId,
        conversationAnchorId: companionBinding.conversationAnchorId,
      })
      .then((result) => {
        if (cancelled) return;
        setVoice((current) =>
          setVoiceCompanionAvailability(bindVoiceCompanionState(current, companionBinding), {
            availability: result.available ? 'ready' : 'blocked',
            message: result.reason,
          }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [bootstrapHandle, companionBinding]);

  // ── Latest assistant message ingest ──────────────────────────────────────────
  const latestAssistantMessage = useMemo(
    () => readLatestAssistantMessage(bundle, companionBinding),
    [bundle, companionBinding],
  );
  const activeTurnCue = useMemo(
    () => readActiveTurnCue(bundle, companionBinding),
    [bundle, companionBinding],
  );
  const turnTerminalCue = useMemo(
    () => readTurnTerminalCue(bundle, companionBinding),
    [bundle, companionBinding],
  );

  useEffect(() => {
    if (!latestAssistantMessage) return;
    setCompanion((current) => {
      const next = bindCompanionState(current, companionBinding);
      if (!next.anchorKey || !companionBinding) return next;
      if (
        next.latestAssistantMessage?.messageId === latestAssistantMessage.messageId
        && next.latestAssistantMessage?.at === latestAssistantMessage.at
        && next.latestAssistantMessage?.text === latestAssistantMessage.text
      ) {
        return next;
      }
      const revealImmediately = shellSettings.bubbleAutoOpen
        || next.bubbleVisible
        || next.sendState === 'sending';
      return ingestAssistantMessage(next, {
        message: latestAssistantMessage,
        revealImmediately,
      });
    });
  }, [
    companionBinding,
    latestAssistantMessage?.at,
    latestAssistantMessage?.messageId,
    latestAssistantMessage?.text,
    shellSettings.bubbleAutoOpen,
  ]);

  // ── Voice caption sync against active turn cue ───────────────────────────────
  useEffect(() => {
    setVoice((current) => {
      let next = bindVoiceCompanionState(current, companionBinding);
      if (!next.anchorKey) return next;
      if (next.awaitingReply && activeTurnCue) {
        if (next.currentTurnId !== activeTurnCue.turnId) {
          next = setVoiceReplyingTurn(next, { turnId: activeTurnCue.turnId });
        }
        const activeTurnText = normalizeText(activeTurnCue.text);
        if (
          activeTurnText
          && (
            next.assistantCaption?.text !== activeTurnText
            || next.assistantCaption?.turnId !== activeTurnCue.turnId
            || next.assistantCaption?.live !== (activeTurnCue.phase !== 'committed')
          )
        ) {
          next = setVoiceAssistantCaption(next, {
            text: activeTurnText,
            at: activeTurnCue.at,
            messageId: null,
            turnId: activeTurnCue.turnId,
            live: activeTurnCue.phase !== 'committed',
          });
        }
      }
      if (
        next.awaitingReply
        && latestAssistantMessage
        && (!next.currentTurnId || latestAssistantMessage.turnId === next.currentTurnId)
        && (
          next.assistantCaption?.text !== latestAssistantMessage.text
          || next.assistantCaption?.at !== latestAssistantMessage.at
          || next.assistantCaption?.turnId !== latestAssistantMessage.turnId
          || next.assistantCaption?.live
        )
      ) {
        next = setVoiceAssistantCaption(next, { ...latestAssistantMessage, live: false });
      }
      if (
        turnTerminalCue
        && (
          next.awaitingReply
          || next.currentTurnId === turnTerminalCue.turnId
          || next.interruptedTurnId === turnTerminalCue.turnId
        )
      ) {
        if (turnTerminalCue.phase === 'interrupted' || turnTerminalCue.phase === 'interrupt_ack') {
          next = interruptVoiceCompanion(next, {
            turnId: turnTerminalCue.interruptedTurnId || turnTerminalCue.turnId,
            message: turnTerminalCue.reason,
          });
        } else {
          next = completeVoiceReplying(next);
        }
      }
      return next;
    });
  }, [
    companionBinding,
    activeTurnCue?.at,
    activeTurnCue?.phase,
    activeTurnCue?.text,
    activeTurnCue?.turnId,
    latestAssistantMessage?.at,
    latestAssistantMessage?.messageId,
    latestAssistantMessage?.text,
    latestAssistantMessage?.turnId,
    turnTerminalCue?.at,
    turnTerminalCue?.interruptedTurnId,
    turnTerminalCue?.phase,
    turnTerminalCue?.reason,
    turnTerminalCue?.turnId,
  ]);

  // ── Bubble auto-collapse ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!shellSettings.bubbleAutoCollapse) return;
    if (!companion.bubbleVisible || companion.sendState === 'sending') return;
    const timer = window.setTimeout(() => {
      setCompanion((current) => collapseCompanionBubble(current));
    }, 9_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    companion.bubbleVisible,
    companion.sendState,
    companion.latestAssistantMessage?.at,
    shellSettings.bubbleAutoCollapse,
  ]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const beginVoiceOperation = (anchorKey: string | null): number => {
    const operationId = voiceOperationCounterRef.current + 1;
    voiceOperationCounterRef.current = operationId;
    voiceOperationRef.current = { id: operationId, anchorKey };
    return operationId;
  };
  const clearVoiceOperation = (operationId: number, anchorKey: string | null): void => {
    if (
      voiceOperationRef.current?.id === operationId
      && voiceOperationRef.current?.anchorKey === anchorKey
    ) {
      voiceOperationRef.current = null;
    }
  };
  const isVoiceOperationCurrent = (operationId: number, anchorKey: string | null): boolean =>
    !unmountedRef.current
    && currentAnchorKeyRef.current === anchorKey
    && voiceOperationRef.current?.id === operationId
    && voiceOperationRef.current?.anchorKey === anchorKey;

  const onCloseVoiceMode = (): void => {
    voiceCaptureSessionRef.current?.cancel();
    voiceCaptureSessionRef.current = null;
    voiceSubmitAbortRef.current?.abort();
    voiceSubmitAbortRef.current = null;
    setVoice((current) => closeVoiceCompanion(current));
  };

  // ── Composition state derivation ─────────────────────────────────────────────
  const composition: CompositionDerivation = useMemo(
    () =>
      deriveCompositionState({
        bootstrapError,
        bootstrapComplete,
        shellReady: shell.shellReady,
        consume,
        runtimeBinding,
        driver,
        launchContext,
        relaunchPending,
      }),
    [
      bootstrapError,
      bootstrapComplete,
      shell.shellReady,
      consume,
      runtimeBinding,
      driver,
      launchContext,
      relaunchPending,
    ],
  );

  // Defensive hover/contact reset when no longer ready.
  useEffect(() => {
    if (composition.ready) return;
    setBodyHovered(false);
    setBodyPointerContact(false);
    setFocusVisibleWithinStage(false);
    if (settingsOpen) setSettingsOpen(false);
    onCloseVoiceMode();
  }, [composition.ready]);

  // ── Render: hard mutually exclusive ──────────────────────────────────────────
  const ambient = composition.ready
    ? bodyHovered || bodyPointerContact || focusVisibleWithinStage
      ? 'engaged'
      : companion.unread
        ? 'unread'
        : 'ready'
    : 'damped';

  const shellClass = [
    'avatar-root',
    `avatar-root--${composition.variant}`,
    `avatar-root--${ambient}`,
  ].join(' ');

  if (!composition.ready) {
    return (
      <div className={shellClass} data-testid="avatar-root" data-composition={composition.state}>
        <DegradedSurface composition={composition} />
      </div>
    );
  }

  return (
    <div className={shellClass} data-testid="avatar-root" data-composition={composition.state}>
      <EmbodimentStage
        visualSession={bootstrapHandle?.carrier?.backendSession ?? null}
        windowSize={shell.windowSize ?? { width: 400, height: 600 }}
        embodied={composition.ready}
        emit={(event) => bootstrapHandle?.driver?.emit(event)}
        setBodyHovered={setBodyHovered}
        setBodyPointerContact={setBodyPointerContact}
        interactionModality={interactionModality}
        onFocusVisibleChange={setFocusVisibleWithinStage}
      />
      <CompanionSurface
        bootstrapHandle={bootstrapHandle}
        binding={companionBinding}
        anchorKey={companionAnchorKey}
        companion={companion}
        voice={voice}
        shellSettings={shellSettings}
        setCompanion={setCompanion}
        setVoice={setVoice}
        voiceCaptureSessionRef={voiceCaptureSessionRef}
        voiceSubmitAbortRef={voiceSubmitAbortRef}
        beginVoiceOperation={beginVoiceOperation}
        clearVoiceOperation={clearVoiceOperation}
        isVoiceOperationCurrent={isVoiceOperationCurrent}
        onSettingsToggle={() => setSettingsOpen((current) => !current)}
        settingsOpen={settingsOpen}
      />
      {settingsOpen ? (
        <section
          id="avatar-companion-settings-popover"
          className="avatar-settings-popover"
          aria-label={t('Avatar.settings.popover_aria')}
          data-testid="avatar-settings-popover"
        >
          <header className="avatar-settings-popover__header">
            <strong>{t('Avatar.settings.header')}</strong>
            <button
              type="button"
              className="avatar-settings-popover__close"
              aria-label={t('Avatar.settings.close_aria')}
              onClick={() => setSettingsOpen(false)}
            >
              ×
            </button>
          </header>
          <label className="avatar-settings-popover__toggle">
            <input
              type="checkbox"
              checked={shellSettings.alwaysOnTop}
              onChange={(event) => persistShellSettings({ ...shellSettings, alwaysOnTop: event.target.checked })}
            />
            <span className="avatar-settings-popover__toggle-text">
              <span className="avatar-settings-popover__toggle-label">{t('Avatar.settings.always_on_top.label')}</span>
              <span className="avatar-settings-popover__toggle-help">{t('Avatar.settings.always_on_top.help')}</span>
            </span>
          </label>
          <label className="avatar-settings-popover__toggle">
            <input
              type="checkbox"
              checked={shellSettings.bubbleAutoOpen}
              onChange={(event) => persistShellSettings({ ...shellSettings, bubbleAutoOpen: event.target.checked })}
            />
            <span className="avatar-settings-popover__toggle-text">
              <span className="avatar-settings-popover__toggle-label">{t('Avatar.settings.bubble_auto_open.label')}</span>
              <span className="avatar-settings-popover__toggle-help">{t('Avatar.settings.bubble_auto_open.help')}</span>
            </span>
          </label>
          <label className="avatar-settings-popover__toggle">
            <input
              type="checkbox"
              checked={shellSettings.bubbleAutoCollapse}
              onChange={(event) => persistShellSettings({ ...shellSettings, bubbleAutoCollapse: event.target.checked })}
            />
            <span className="avatar-settings-popover__toggle-text">
              <span className="avatar-settings-popover__toggle-label">{t('Avatar.settings.bubble_auto_collapse.label')}</span>
              <span className="avatar-settings-popover__toggle-help">{t('Avatar.settings.bubble_auto_collapse.help')}</span>
            </span>
          </label>
          <label className="avatar-settings-popover__toggle">
            <input
              type="checkbox"
              checked={shellSettings.showVoiceCaptions}
              onChange={(event) => persistShellSettings({ ...shellSettings, showVoiceCaptions: event.target.checked })}
            />
            <span className="avatar-settings-popover__toggle-text">
              <span className="avatar-settings-popover__toggle-label">{t('Avatar.settings.show_voice_captions.label')}</span>
              <span className="avatar-settings-popover__toggle-help">{t('Avatar.settings.show_voice_captions.help')}</span>
            </span>
          </label>
          {shellSettings.showVoiceCaptions !== defaultAvatarShellSettings.showVoiceCaptions ? (
            <p className="avatar-settings-popover__note">
              {t('Avatar.settings.show_voice_captions.note')}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

// Wave 1 — Avatar shell root component.
// Per app-shell-contract.md K-NAV-SHELL-COMPOSITION-002 the shell mounts exactly
// one of: (embodiment-stage + companion-surface) OR degraded-surface.
// The retired mixed `recovery panel` + `trigger toggle` paths are
// hard-cut; companion-surface is always-visible while ready.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconButton, Surface, Toggle, cn } from '@nimiplatform/kit/ui';
import { useTranslation } from './i18n/index.js';
import { bootstrapAvatar, type BootstrapHandle } from './app-shell/app-bootstrap.js';
import { useAvatarStore } from './app-shell/app-store.js';
import { recordAvatarEvidenceEventually } from './app-shell/avatar-evidence.js';
import { setAlwaysOnTop } from './app-shell/tauri-commands.js';
import { useWindowBoundsSync } from './app-shell/use-window-bounds-sync.js';
import { isTauriRuntime, onLaunchContextUpdated } from './app-shell/tauri-lifecycle.js';
import { deriveCompositionState, type CompositionDerivation } from './app-shell/composition-state.js';
import {
  emitCompositionRelaunchPending,
  emitCompositionTransition,
} from './app-shell/composition-events.js';
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
import { getSharedAudioPipelineController } from './audio/audio-pipeline.js';
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
    const audio = getSharedAudioPipelineController();
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

  const getEmbodimentBounds = useCallback(() => {
    // Wave_1 step_4: bounds are sourced from the active BackendBranch
    // (`backend.nominalBounds`) so the window resize loop is decoupled
    // from the Live2D-specific projection-api.getSurfaceBounds path.
    const bounds = bootstrapHandle?.carrier?.backend?.nominalBounds ?? null;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }
    return { width: bounds.width, height: bounds.height };
  }, [bootstrapHandle]);

  // ── Wave 4 dynamic window bounds sync ────────────────────────────────────────
  // The bounds source must be backend-owned, not the embodiment-stage DOM rect;
  // reading a window-sized DOM node here would feed set_size back into itself.
  useWindowBoundsSync({
    isReady: bootstrapComplete,
    getEmbodimentBounds,
  });

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
      emitCompositionRelaunchPending({
        agentId: payload.agentId,
        avatarInstanceId: payload.avatarInstanceId ?? null,
        launchSource: payload.launchSource ?? null,
      });
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

  // ── Composition transition evidence (K-NAV-SHELL-COMPOSITION-004) ──────────────
  // Observes composition derivation changes and emits
  // `avatar.composition.transition` whenever the state field actually flips.
  // The first observation establishes the baseline (no `from`) so we can
  // record the initial mount as a transition from `null`. Variant / reason
  // toggles within the same state are ignored to avoid spam.
  const previousCompositionRef = useRef<CompositionDerivation | null>(null);
  useEffect(() => {
    const previous = previousCompositionRef.current;
    if (!previous || previous.state !== composition.state) {
      emitCompositionTransition(previous, composition);
      previousCompositionRef.current = composition;
    } else {
      // Update the cached snapshot so future comparisons see the latest reason
      // values without re-emitting transition.
      previousCompositionRef.current = composition;
    }
  }, [composition]);

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

  const shellClass = cn(
    'avatar-root',
    `avatar-root--${composition.variant}`,
    `avatar-root--${ambient}`,
  );

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
        backend={bootstrapHandle?.carrier?.backend ?? null}
        windowSize={shell.windowSize ?? { width: 400, height: 600 }}
        embodied={composition.ready}
        compositionState={composition.state}
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
        compositionState={composition.state}
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
        <Surface
          as="section"
          material="glass-thick"
          tone="overlay"
          elevation="floating"
          padding="none"
          id="avatar-companion-settings-popover"
          className="avatar-settings-popover nimi-material-glass-thick backdrop-blur-[var(--nimi-backdrop-blur-strong)]"
          aria-label={t('Avatar.settings.popover_aria')}
          data-testid="avatar-settings-popover"
        >
          <header className="avatar-settings-popover__header">
            <strong>{t('Avatar.settings.header')}</strong>
            <IconButton
              className="avatar-settings-popover__close"
              aria-label={t('Avatar.settings.close_aria')}
              onClick={() => setSettingsOpen(false)}
              icon="×"
              size="sm"
              tone="ghost"
            />
          </header>
          <div className="avatar-settings-popover__toggle">
            <Toggle
              checked={shellSettings.alwaysOnTop}
              onChange={(checked) => persistShellSettings({ ...shellSettings, alwaysOnTop: checked })}
            />
            <span className="avatar-settings-popover__toggle-text">
              <span className="avatar-settings-popover__toggle-label">{t('Avatar.settings.always_on_top.label')}</span>
              <span className="avatar-settings-popover__toggle-help">{t('Avatar.settings.always_on_top.help')}</span>
            </span>
          </div>
          <div className="avatar-settings-popover__toggle">
            <Toggle
              checked={shellSettings.bubbleAutoOpen}
              onChange={(checked) => persistShellSettings({ ...shellSettings, bubbleAutoOpen: checked })}
            />
            <span className="avatar-settings-popover__toggle-text">
              <span className="avatar-settings-popover__toggle-label">{t('Avatar.settings.bubble_auto_open.label')}</span>
              <span className="avatar-settings-popover__toggle-help">{t('Avatar.settings.bubble_auto_open.help')}</span>
            </span>
          </div>
          <div className="avatar-settings-popover__toggle">
            <Toggle
              checked={shellSettings.bubbleAutoCollapse}
              onChange={(checked) => persistShellSettings({ ...shellSettings, bubbleAutoCollapse: checked })}
            />
            <span className="avatar-settings-popover__toggle-text">
              <span className="avatar-settings-popover__toggle-label">{t('Avatar.settings.bubble_auto_collapse.label')}</span>
              <span className="avatar-settings-popover__toggle-help">{t('Avatar.settings.bubble_auto_collapse.help')}</span>
            </span>
          </div>
          <div className="avatar-settings-popover__toggle">
            <Toggle
              checked={shellSettings.showVoiceCaptions}
              onChange={(checked) => persistShellSettings({ ...shellSettings, showVoiceCaptions: checked })}
            />
            <span className="avatar-settings-popover__toggle-text">
              <span className="avatar-settings-popover__toggle-label">{t('Avatar.settings.show_voice_captions.label')}</span>
              <span className="avatar-settings-popover__toggle-help">{t('Avatar.settings.show_voice_captions.help')}</span>
            </span>
          </div>
          {shellSettings.showVoiceCaptions !== defaultAvatarShellSettings.showVoiceCaptions ? (
            <p className="avatar-settings-popover__note">
              {t('Avatar.settings.show_voice_captions.note')}
            </p>
          ) : null}
        </Surface>
      ) : null}
    </div>
  );
}

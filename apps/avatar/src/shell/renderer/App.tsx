// Avatar shell root component.
// App-local prerequisite composition mounts exactly one of
// embodiment-stage or degraded-surface.
// The retired mixed `recovery panel` + `trigger toggle` paths are
// hard-cut; text/settings controls now move to transient overlays.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import { useNimiReducedMotion } from '@nimiplatform/kit/ui/motion';
import { bootstrapAvatar, type BootstrapHandle } from './app-shell/app-bootstrap.js';
import { useAvatarStore } from './app-shell/app-store.js';
import { setAlwaysOnTop } from './app-shell/avatar-window-commands.js';
import { useWindowBoundsSync } from './app-shell/use-window-bounds-sync.js';
import { onHostSuspend, onLaunchContextUpdated } from './app-shell/tauri-lifecycle.js';
import { deriveCompositionState, type CompositionDerivation } from './app-shell/composition-state.js';
import { EmbodimentStage } from './embodiment-stage/embodiment-stage.js';
import { DegradedSurface } from './degraded-surface/degraded-surface.js';
import {
  createCompanionAnchorKey,
  readTurnTerminalCue,
  type CompanionAnchorBinding,
} from './companion-state.js';
import {
  activateLipsync,
  bindVoiceCompanionState,
  beginVoiceInterruptRequest,
  closeVoiceCompanion,
  completeVoiceReplying,
  deactivateLipsync,
  initialVoiceCompanionState,
  interruptVoiceCompanion,
  openVoiceCompanion,
  setAudioPlaybackState,
  setMouthOpenY,
  setVoiceCompanionAvailability,
  setVoiceCompanionError,
} from './voice-companion-state.js';
import {
  getSharedAudioPipelineController,
  getSharedVoiceLipsyncStateBus,
  type AudioPlaybackSnapshot,
} from '@nimiplatform/kit/features/avatar/headless';
import {
  readAvatarShellSettings,
  type AvatarShellSettings,
} from './settings-state.js';
import type { AvatarVoiceCaptureSession } from './voice-capture.js';
import { normalizeText, toErrorMessage } from './avatar-shell-utils.js';
import { useAvatarShellScale } from './use-avatar-shell-scale.js';
import { useAvatarShellOverlays } from './use-avatar-shell-overlays.js';
import { hasAvatarHostRuntime } from './app-shell/avatar-host-bridge.js';
import { installAvatarAgentCenterPreviewHandoff } from './agent-center-preview/agent-center-preview-handoff.js';
import {
  AvatarRuntimeStatusRegion,
  deriveAvatarRuntimeStatus,
} from './avatar-runtime-status.js';
import {
  CompanionSurface,
  shouldMountCompanionSurface,
} from './companion-surface/companion-surface.js';
import { setAvatarLocalQuiet } from './local-quiet-state.js';
import { reloadAvatarShell } from './shell-reload.js';

export function App() {
  const reducedMotion = useNimiReducedMotion();
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const [bootstrapHandle, setBootstrapHandle] = useState<BootstrapHandle | null>(null);
  const [, setPresentationEpoch] = useState(0);
  const [voice, setVoice] = useState(initialVoiceCompanionState);
  const [audioPlayback, setAudioPlayback] = useState<AudioPlaybackSnapshot>(() =>
    getSharedAudioPipelineController().getSnapshot(),
  );
  const [shellSettings, setShellSettings] = useState<AvatarShellSettings>(() =>
    readAvatarShellSettings(),
  );
  const [interactionModality, setInteractionModality] = useState<'keyboard' | 'pointer'>('pointer');
  const [bodyHovered, setBodyHovered] = useState(false);
  const [bodyPointerContact, setBodyPointerContact] = useState(false);
  const [focusVisibleWithinStage, setFocusVisibleWithinStage] = useState(false);
  const [relaunchPending, setRelaunchPending] = useState(false);
  const [quietLatched, setQuietLatched] = useState(false);

  const voiceCaptureSessionRef = useRef<AvatarVoiceCaptureSession | null>(null);
  const voiceSubmitAbortRef = useRef<AbortController | null>(null);
  const voiceOperationSequenceRef = useRef(0);
  const voiceOperationRef = useRef<{ id: number; anchorKey: string | null } | null>(null);
  const compositionWasReadyRef = useRef(false);

  const bundle = useAvatarStore((s) => s.bundle);
  const shell = useAvatarStore((s) => s.shell);
  const model = useAvatarStore((s) => s.model);
  const consume = useAvatarStore((s) => s.consume);
  const driver = useAvatarStore((s) => s.driver);
  const runtimeBinding = useAvatarStore((s) => s.runtime.binding);
  const launchContext = useAvatarStore((s) => s.launch.context);

  useEffect(() => {
    setAvatarLocalQuiet(false);
    return () => setAvatarLocalQuiet(false);
  }, []);

  useEffect(() => {
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
      voiceCaptureSessionRef.current?.cancel();
      voiceCaptureSessionRef.current = null;
      voiceSubmitAbortRef.current?.abort();
      voiceSubmitAbortRef.current = null;
      setBootstrapHandle(null);
      void handle?.shutdown();
    };
  }, []);

  useEffect(() => {
    if (!hasAvatarHostRuntime()) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void installAvatarAgentCenterPreviewHandoff({
      getContext: () => ({
        agentHandle: useAvatarStore.getState().consume.agentHandle,
        conversationAnchorId: useAvatarStore.getState().consume.conversationAnchorId,
        carrier: bootstrapHandle?.carrier ?? null,
      }),
      async activatePresentation(request) {
        await bootstrapHandle!.activateCommittedPresentation(request);
        setPresentationEpoch((current) => current + 1);
      },
    }).then((release) => {
      if (cancelled) {
        release();
        return;
      }
      unlisten = release;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [bootstrapHandle]);

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
      setAudioPlayback(snapshot);
      setVoice((current) => setAudioPlaybackState(current, snapshot.state));
    });
    return () => {
      unsubscribeBus();
      unsubscribeAudio();
    };
  }, []);

  const getEmbodimentBounds = useCallback(() => {
    // Bounds are sourced from the active BackendBranch
    // (`backend.nominalBounds`) so the window resize loop is decoupled
    // from the Live2D-specific projection-api.getSurfaceBounds path.
    const bounds = bootstrapHandle?.carrier?.backend?.nominalBounds ?? null;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }
    return { width: bounds.width, height: bounds.height };
  }, [bootstrapHandle]);

  const { avatarScale, updateAvatarScale, handleAvatarWheel } = useAvatarShellScale({
    consume,
    launchContext,
  });

  // ── Wave 4 dynamic window bounds sync ────────────────────────────────────────
  // The bounds source must be backend-owned, not the embodiment-stage DOM rect;
  // reading a window-sized DOM node here would feed set_size back into itself.
  useWindowBoundsSync({
    isReady: bootstrapComplete,
    getEmbodimentBounds,
    avatarScale,
  });

  // ── Always-on-top settings sync ──────────────────────────────────────────────
  useEffect(() => {
    useAvatarStore.getState().setAlwaysOnTop(shellSettings.alwaysOnTop);
  }, [shellSettings.alwaysOnTop]);

  useEffect(() => {
    if (!hasAvatarHostRuntime()) return;
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
    if (!hasAvatarHostRuntime()) return;
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
      voiceOperationSequenceRef.current += 1;
      voiceOperationRef.current = null;
      getSharedAudioPipelineController().stop('interrupted');
      getSharedAudioPipelineController().reset();
      getSharedVoiceLipsyncStateBus().publish({ kind: 'deactivate' });
      setAvatarLocalQuiet(false);
      setQuietLatched(false);
      setVoice(initialVoiceCompanionState);
      void reloadAvatarShell();
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
    const agentHandle = normalizeText(consume.agentHandle);
    const conversationAnchorId = normalizeText(consume.conversationAnchorId);
    if (!agentHandle || !conversationAnchorId) return null;
    return { agentHandle, conversationAnchorId };
  }, [consume.agentHandle, consume.conversationAnchorId]);

  const companionAnchorKey = createCompanionAnchorKey(companionBinding);
  const beginVoiceOperation = useCallback((anchorKey: string | null): number => {
    const id = ++voiceOperationSequenceRef.current;
    voiceOperationRef.current = { id, anchorKey };
    return id;
  }, []);
  const clearVoiceOperation = useCallback((id: number, anchorKey: string | null): void => {
    const current = voiceOperationRef.current;
    if (current?.id === id && current.anchorKey === anchorKey) {
      voiceOperationRef.current = null;
    }
  }, []);
  const isVoiceOperationCurrent = useCallback((id: number, anchorKey: string | null): boolean => {
    const current = voiceOperationRef.current;
    return current?.id === id && current.anchorKey === anchorKey;
  }, []);
  const cancelLocalVoice = useCallback((): void => {
    voiceOperationSequenceRef.current += 1;
    voiceOperationRef.current = null;
    voiceCaptureSessionRef.current?.cancel();
    voiceCaptureSessionRef.current = null;
    voiceSubmitAbortRef.current?.abort();
    voiceSubmitAbortRef.current = null;
    getSharedAudioPipelineController().stop('interrupted');
    getSharedAudioPipelineController().reset();
    getSharedVoiceLipsyncStateBus().publish({ kind: 'deactivate' });
  }, []);
  const reengageCompanion = useCallback((): void => {
    setAvatarLocalQuiet(false);
    setQuietLatched(false);
  }, []);
  const engageCompanion = useCallback((): void => {
    reengageCompanion();
    setVoice((current) => openVoiceCompanion(bindVoiceCompanionState(current, companionBinding)));
  }, [companionBinding, reengageCompanion]);
  const enterLocalQuiet = useCallback((): void => {
    cancelLocalVoice();
    setAvatarLocalQuiet(true);
    setQuietLatched(true);
    setVoice((current) => closeVoiceCompanion(bindVoiceCompanionState(current, companionBinding)));
    try {
      bootstrapHandle?.carrier?.backend?.projection.applyActivity({
        name: 'idle',
        intensity: 0.2,
      });
    } catch (error: unknown) {
      console.warn('[avatar:shell] Quiet idle presentation failed after local cleanup', error);
    }
  }, [bootstrapHandle, cancelLocalVoice, companionBinding]);
  useEffect(() => {
    if (!hasAvatarHostRuntime()) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    void onHostSuspend(() => {
      if (active) enterLocalQuiet();
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [enterLocalQuiet]);

  useEffect(() => {
    cancelLocalVoice();
    setVoice((current) => bindVoiceCompanionState(current, companionBinding));
  }, [cancelLocalVoice, companionAnchorKey, companionBinding]);

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
        agentHandle: companionBinding.agentHandle,
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
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setVoice((current) =>
          setVoiceCompanionAvailability(bindVoiceCompanionState(current, companionBinding), {
            availability: 'blocked',
            message: toErrorMessage(error),
          }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [bootstrapHandle, companionBinding]);

  // ── Latest assistant message ingest ──────────────────────────────────────────
  const turnTerminalCue = useMemo(
    () => readTurnTerminalCue(bundle, companionBinding),
    [bundle, companionBinding],
  );

  // ── Voice caption sync against active turn cue ───────────────────────────────
  useEffect(() => {
    setVoice((current) => {
      let next = bindVoiceCompanionState(current, companionBinding);
      if (!next.anchorKey) return next;
      if (quietLatched) return closeVoiceCompanion(next);
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
    turnTerminalCue?.at,
    turnTerminalCue?.interruptedTurnId,
    turnTerminalCue?.phase,
    turnTerminalCue?.reason,
    turnTerminalCue?.turnId,
    quietLatched,
  ]);

  // Final captions and interruption acknowledgments remain briefly visible,
  // then the event-driven capsule returns to the quiet body-only posture.
  useEffect(() => {
    const terminalCaption = voice.status === 'idle'
      && Boolean(voice.userCaption || voice.assistantCaption);
    if (!terminalCaption && voice.status !== 'interrupted') return;
    const timer = window.setTimeout(() => {
      setVoice((current) => closeVoiceCompanion(current));
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [voice.assistantCaption, voice.status, voice.userCaption]);

  const onCloseVoiceMode = useCallback((): void => {
    cancelLocalVoice();
    setVoice((current) => closeVoiceCompanion(current));
  }, [cancelLocalVoice]);
  const prepareRuntimeInterrupt = useCallback((): void => {
    getSharedAudioPipelineController().stop('interrupted');
    getSharedAudioPipelineController().reset();
    getSharedVoiceLipsyncStateBus().publish({ kind: 'deactivate' });
    setVoice((current) => beginVoiceInterruptRequest(current));
  }, []);
  const failRuntimeInterrupt = useCallback((message: string): void => {
    setVoice((current) => setVoiceCompanionError(current, message));
  }, []);

  // ── Composition state derivation ─────────────────────────────────────────────
  const composition: CompositionDerivation = useMemo(
    () =>
      deriveCompositionState({
        bootstrapError,
        bootstrapComplete,
        shellReady: shell.shellReady,
        model,
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
      model,
      consume,
      runtimeBinding,
      driver,
      launchContext,
      relaunchPending,
    ],
  );

  const {
    handleAvatarOriginEvent,
    dismissTransientSurfaces,
    openTextInputFromCapsule,
    overlayNodes,
  } = useAvatarShellOverlays({
    bootstrapHandle,
    companionBinding,
    consume,
    shellSettings,
    setShellSettings,
    avatarScale,
    updateAvatarScale,
    quietLatched,
    onOpenCapsule: engageCompanion,
    onReengage: reengageCompanion,
    onQuiet: enterLocalQuiet,
  });

  // Defensive hover/contact reset when no longer ready.
  useEffect(() => {
    if (composition.ready) {
      compositionWasReadyRef.current = true;
      return;
    }
    setBodyHovered(false);
    setBodyPointerContact(false);
    setFocusVisibleWithinStage(false);
    dismissTransientSurfaces('composition_change');
    if (compositionWasReadyRef.current) {
      compositionWasReadyRef.current = false;
      enterLocalQuiet();
      return;
    }
    onCloseVoiceMode();
  }, [
    composition.ready,
    dismissTransientSurfaces,
    enterLocalQuiet,
    onCloseVoiceMode,
  ]);

  // ── Render: hard mutually exclusive ──────────────────────────────────────────
  const ambient = composition.ready
    ? quietLatched
      ? 'ready'
      : bodyHovered || bodyPointerContact || focusVisibleWithinStage
      ? 'engaged'
      : 'ready'
    : 'damped';

  const shellClass = cn(
    'avatar-root',
    `avatar-root--${composition.variant}`,
    `avatar-root--${ambient}`,
  );
  const runtimeStatus = deriveAvatarRuntimeStatus({
    compositionReady: composition.ready,
    compositionState: composition.state,
    audio: audioPlayback,
  });
  const committedPresentation = bootstrapHandle?.carrier?.committedPresentationSelection ?? null;

  if (!composition.ready) {
    return (
      <div
        className={shellClass}
        data-testid="avatar-root"
        data-composition={composition.state}
        data-avatar-status={runtimeStatus}
      >
        <DegradedSurface composition={composition} />
        <AvatarRuntimeStatusRegion status={runtimeStatus} />
      </div>
    );
  }

  return (
    <div
      className={shellClass}
      data-testid="avatar-root"
      data-composition={composition.state}
      data-avatar-status={runtimeStatus}
      data-avatar-presentation-asset-ref={committedPresentation?.avatarAssetRef}
      data-avatar-presentation-backend={committedPresentation?.backendKind}
      data-avatar-presentation-revision={committedPresentation?.presentationRevision}
    >
      <EmbodimentStage
        backend={bootstrapHandle?.carrier?.backend ?? null}
        windowSize={shell.windowSize ?? { width: 400, height: 600 }}
        embodied={composition.ready}
        reducedMotion={reducedMotion || quietLatched}
        emit={handleAvatarOriginEvent}
        setBodyHovered={setBodyHovered}
        setBodyPointerContact={setBodyPointerContact}
        onAvatarWheel={handleAvatarWheel}
        interactionModality={interactionModality}
        onFocusVisibleChange={setFocusVisibleWithinStage}
      />
      {shouldMountCompanionSurface(voice) && !quietLatched ? (
        <CompanionSurface
          bootstrapHandle={bootstrapHandle}
          binding={companionBinding}
          anchorKey={companionAnchorKey}
          voice={voice}
          shellSettings={shellSettings}
          compositionState={composition.state}
          setVoice={setVoice}
          voiceCaptureSessionRef={voiceCaptureSessionRef}
          voiceSubmitAbortRef={voiceSubmitAbortRef}
          beginVoiceOperation={beginVoiceOperation}
          clearVoiceOperation={clearVoiceOperation}
          isVoiceOperationCurrent={isVoiceOperationCurrent}
          onExplicitEngage={engageCompanion}
          onOpenTextInput={openTextInputFromCapsule}
          onInterruptLocalCleanup={prepareRuntimeInterrupt}
          onInterruptFailure={failRuntimeInterrupt}
          onClose={onCloseVoiceMode}
        />
      ) : null}
      <AvatarRuntimeStatusRegion status={runtimeStatus} />
      {overlayNodes}
    </div>
  );
}

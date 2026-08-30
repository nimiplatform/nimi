// Avatar shell root component.
// App-local prerequisite composition mounts a live product embodiment, an
// explicitly not-verified development preview, or a degraded surface.
// The retired mixed `recovery panel` + `trigger toggle` paths are
// hard-cut; text/settings controls now move to transient overlays.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import { useNimiReducedMotion } from '@nimiplatform/kit/ui/motion';
import { bootstrapAvatar, type BootstrapHandle } from './app-shell/app-bootstrap.js';
import { useAvatarStore } from './app-shell/app-store.js';
import { setAlwaysOnTop } from './app-shell/avatar-window-commands.js';
import { useWindowBoundsSync } from './app-shell/use-window-bounds-sync.js';
import { onHostSuspend, onLaunchContextUpdated } from './app-shell/host-lifecycle.js';
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
  setVoiceAssistantCaption,
  setVoiceCompanionError,
} from './voice-companion-state.js';
import {
  getSharedAudioPipelineController,
  getSharedVoiceLipsyncStateBus,
  type AudioPlaybackSnapshot,
} from '@nimiplatform/kit/features/avatar/headless';
import {
  avatarCaptionDurationMs,
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
import {
  AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT,
  AVATAR_CONVERSATION_VOICE_FAILED_EVENT,
} from './voice-lipsync/avatar-conversation-voice.js';
import type {
  BackendPresentationState,
  BackendSurfaceBounds,
} from './carrier/backend-branch.js';
import type { AvatarRuntimeCarrier } from './carrier/avatar-carrier.js';
import { isAvatarPresentationRollbackUnavailableError } from './app-shell/live-presentation-swap.js';

type StagedPresentation = Readonly<{
  carrier: AvatarRuntimeCarrier;
  presentationKey: string;
  settled: { value: boolean };
  resolve: () => void;
  reject: (error: Error) => void;
}>;

function carrierPresentationKey(carrier: AvatarRuntimeCarrier | null | undefined): string | null {
  if (!carrier) return null;
  const selection = carrier.committedPresentationSelection;
  const modelId = (carrier as AvatarRuntimeCarrier & {
    model?: { modelId?: string };
  }).model?.modelId?.trim();
  const backendKind = (carrier as AvatarRuntimeCarrier & {
    backend?: { kind?: string };
  }).backend?.kind?.trim();
  return selection
    ? `${selection.backendKind}:${selection.avatarAssetRef}:${selection.presentationRevision}`
    : `${backendKind || 'unbound'}:${modelId || 'unbound'}`;
}

export function App() {
  const reducedMotion = useNimiReducedMotion();
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const [bootstrapHandle, setBootstrapHandle] = useState<BootstrapHandle | null>(null);
  const [, setPresentationEpoch] = useState(0);
  const [backendPresentation, setBackendPresentation] = useState<BackendPresentationState>({
    kind: 'loading',
  });
  const [stagedPresentation, setStagedPresentation] = useState<StagedPresentation | null>(null);
  const [surfaceBoundsRevision, setSurfaceBoundsRevision] = useState(0);
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
  const voiceCaptionsSuppressedRef = useRef(false);
  const activeVoiceCaptionIdRef = useRef<string | null>(null);
  const backendPresentationRef = useRef<BackendPresentationState>(backendPresentation);
  const backendWasReadyRef = useRef(false);
  const backendSurfaceBoundsRef = useRef<BackendSurfaceBounds | null>(null);
  const stagedPresentationRef = useRef<StagedPresentation | null>(null);
  const initialLeaseCommitInFlightRef = useRef<string | null>(null);
  const committedLeasePresentationRef = useRef<string | null>(null);

  const bundle = useAvatarStore((s) => s.bundle);
  const shell = useAvatarStore((s) => s.shell);
  const model = useAvatarStore((s) => s.model);
  const consume = useAvatarStore((s) => s.consume);
  const driver = useAvatarStore((s) => s.driver);
  const runtimeBinding = useAvatarStore((s) => s.runtime.binding);
  const launchContext = useAvatarStore((s) => s.launch.context);

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
  const productCompositionReady = composition.ready && consume.authority === 'runtime';
  const presentationReady = productCompositionReady && backendPresentation.kind === 'ready';

  useEffect(() => {
    // Fixture rendering is a development-only visual preview. Keeping the
    // shared local projection gate quiet prevents fixture driver events and
    // audio from becoming live embodiment behavior.
    setAvatarLocalQuiet(!presentationReady);
    return () => setAvatarLocalQuiet(false);
  }, [presentationReady]);

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
      const staged = stagedPresentationRef.current;
      if (staged && !staged.settled.value) {
        staged.settled.value = true;
        staged.reject(new Error('Avatar presentation staging was closed.'));
      }
      stagedPresentationRef.current = null;
      voiceCaptureSessionRef.current?.cancel();
      voiceCaptureSessionRef.current = null;
      voiceSubmitAbortRef.current?.abort();
      voiceSubmitAbortRef.current = null;
      setBootstrapHandle(null);
      void handle?.shutdown();
    };
  }, []);

  useEffect(() => {
    if (!hasAvatarHostRuntime() || !productCompositionReady || !bootstrapHandle) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void installAvatarAgentCenterPreviewHandoff({
      getContext: () => ({
        agentHandle: useAvatarStore.getState().consume.agentHandle,
        conversationAnchorId: useAvatarStore.getState().consume.conversationAnchorId,
        carrier: bootstrapHandle?.carrier ?? null,
      }),
      async activatePresentation(request) {
        const previousPresentation = backendPresentationRef.current;
        try {
          await bootstrapHandle!.activateCommittedPresentation(request, (candidate) => (
            new Promise<void>((resolve, reject) => {
              const settled = { value: false };
              const staged: StagedPresentation = {
                carrier: candidate,
                presentationKey: carrierPresentationKey(candidate)!,
                settled,
                resolve,
                reject,
              };
              stagedPresentationRef.current = staged;
              setStagedPresentation(staged);
            })
          ));
          backendSurfaceBoundsRef.current = null;
          backendPresentationRef.current = { kind: 'ready' };
          setBackendPresentation({ kind: 'ready' });
          setPresentationEpoch((current) => current + 1);
          stagedPresentationRef.current = null;
          setStagedPresentation(null);
        } catch (error) {
          stagedPresentationRef.current = null;
          setStagedPresentation(null);
          if (isAvatarPresentationRollbackUnavailableError(error)) {
            const unavailable: BackendPresentationState = {
              kind: 'unavailable',
              reason: toErrorMessage(error),
            };
            backendPresentationRef.current = unavailable;
            setBackendPresentation(unavailable);
            throw error;
          }
          backendPresentationRef.current = previousPresentation;
          setBackendPresentation(previousPresentation);
          throw error;
        }
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
  }, [bootstrapHandle, productCompositionReady]);

  // ── Wave 3 lipsync state subscription ────────────────────────────────────────
  // The avatar-voice-lipsync pipeline (wired from carrier/avatar-carrier.ts)
  // publishes `activate / mouth_open_y / audio_playback_state / deactivate`
  // events into the shared bus; the audio playback controller publishes its
  // own snapshots. We mirror both into voice-companion-state so the companion
  // surface can render mouth + playback indicators in lockstep with Live2D.
  useEffect(() => {
    if (!presentationReady) return;
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
  }, [presentationReady]);

  const getEmbodimentBounds = useCallback(() => {
    // Bounds are sourced from the active BackendBranch
    // (`backend.nominalBounds`) so the window resize loop is decoupled
    // from the Live2D-specific projection-api.getSurfaceBounds path.
    const bounds = backendSurfaceBoundsRef.current?.bounds
      ?? bootstrapHandle?.carrier?.backend?.nominalBounds
      ?? null;
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
    isReady: composition.renderable,
    getEmbodimentBounds,
    avatarScale,
    surfaceBoundsRevision,
  });

  const handleBackendPresentationState = useCallback((state: BackendPresentationState): void => {
    if (!productCompositionReady
      || state.kind !== 'ready'
      || !bootstrapHandle?.carrier?.committedPresentationSelection) {
      backendPresentationRef.current = state;
      setBackendPresentation(state);
      return;
    }
    const presentationKey = carrierPresentationKey(bootstrapHandle.carrier);
    const commitInitialPresentation = bootstrapHandle.commitInitialPresentation;
    if (!presentationKey || typeof commitInitialPresentation !== 'function') {
      backendPresentationRef.current = state;
      setBackendPresentation(state);
      return;
    }
    if (committedLeasePresentationRef.current === presentationKey) {
      backendPresentationRef.current = state;
      setBackendPresentation(state);
      return;
    }
    if (initialLeaseCommitInFlightRef.current === presentationKey) return;
    initialLeaseCommitInFlightRef.current = presentationKey;
    void commitInitialPresentation().then(() => {
      initialLeaseCommitInFlightRef.current = null;
      if (carrierPresentationKey(bootstrapHandle.carrier) !== presentationKey) return;
      committedLeasePresentationRef.current = presentationKey;
      backendPresentationRef.current = state;
      setBackendPresentation(state);
    }).catch((error: unknown) => {
      initialLeaseCommitInFlightRef.current = null;
      if (carrierPresentationKey(bootstrapHandle.carrier) !== presentationKey) return;
      const unavailable: BackendPresentationState = {
        kind: 'unavailable',
        reason: toErrorMessage(error),
      };
      backendPresentationRef.current = unavailable;
      setBackendPresentation(unavailable);
    });
  }, [bootstrapHandle, productCompositionReady]);

  const handleStagedPresentationState = useCallback((state: BackendPresentationState): void => {
    const staged = stagedPresentationRef.current;
    if (!staged || staged.settled.value) return;
    if (state.kind === 'ready') {
      staged.settled.value = true;
      staged.resolve();
      return;
    }
    if (state.kind === 'unavailable') {
      staged.settled.value = true;
      staged.reject(new Error(state.reason));
    }
  }, []);

  const handleBackendSurfaceBounds = useCallback((surface: BackendSurfaceBounds): void => {
    const current = backendSurfaceBoundsRef.current;
    if (current
      && current.source === surface.source
      && current.reasonCode === surface.reasonCode
      && current.bounds.width === surface.bounds.width
      && current.bounds.height === surface.bounds.height
      && current.bounds.bodyCenterX === surface.bounds.bodyCenterX
      && current.bounds.bodyCenterY === surface.bounds.bodyCenterY) {
      return;
    }
    backendSurfaceBoundsRef.current = surface;
    setSurfaceBoundsRevision((revision) => revision + 1);
  }, []);

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
      activeVoiceCaptionIdRef.current = null;
      getSharedAudioPipelineController().stop('interrupted');
      getSharedAudioPipelineController().reset();
      getSharedVoiceLipsyncStateBus().publish({ kind: 'deactivate' });
      setAvatarLocalQuiet(false);
      setQuietLatched(false);
      voiceCaptionsSuppressedRef.current = true;
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
    if (!presentationReady) return null;
    const agentHandle = normalizeText(consume.agentHandle);
    const conversationAnchorId = normalizeText(consume.conversationAnchorId);
    if (!agentHandle || !conversationAnchorId) return null;
    return { agentHandle, conversationAnchorId };
  }, [consume.agentHandle, consume.conversationAnchorId, presentationReady]);

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
    activeVoiceCaptionIdRef.current = null;
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
    voiceCaptionsSuppressedRef.current = false;
  }, []);
  const engageCompanion = useCallback((): void => {
    reengageCompanion();
    setVoice((current) => openVoiceCompanion(bindVoiceCompanionState(current, companionBinding)));
  }, [companionBinding, reengageCompanion]);
  const enterLocalQuiet = useCallback((): void => {
    cancelLocalVoice();
    voiceCaptionsSuppressedRef.current = true;
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
      activeVoiceCaptionIdRef.current = null;
      setVoice((current) => closeVoiceCompanion(current));
    }, avatarCaptionDurationMs(shellSettings.captionDuration));
    return () => window.clearTimeout(timer);
  }, [shellSettings.captionDuration, voice.assistantCaption, voice.status, voice.userCaption]);

  const onCloseVoiceMode = useCallback((): void => {
    voiceCaptionsSuppressedRef.current = true;
    cancelLocalVoice();
    setVoice((current) => closeVoiceCompanion(current));
  }, [cancelLocalVoice]);
  const prepareRuntimeInterrupt = useCallback((): void => {
    voiceCaptionsSuppressedRef.current = true;
    activeVoiceCaptionIdRef.current = null;
    getSharedAudioPipelineController().stop('interrupted');
    getSharedAudioPipelineController().reset();
    getSharedVoiceLipsyncStateBus().publish({ kind: 'deactivate' });
    setVoice((current) => beginVoiceInterruptRequest(current));
  }, []);
  const failRuntimeInterrupt = useCallback((message: string): void => {
    setVoice((current) => setVoiceCompanionError(current, message));
  }, []);

  useEffect(() => {
    const activeDriver = bootstrapHandle?.driver;
    if (!activeDriver) return;
    return activeDriver.onEvent((event) => {
      if (event.name === AVATAR_CONVERSATION_VOICE_FAILED_EVENT) {
        const failedVoiceId = typeof event.detail['voice_id'] === 'string'
          ? event.detail['voice_id'].trim()
          : '';
        if (!failedVoiceId || activeVoiceCaptionIdRef.current !== failedVoiceId) return;
        activeVoiceCaptionIdRef.current = null;
        setVoice((current) => setAudioPlaybackState({
          ...deactivateLipsync(current),
          assistantCaption: null,
        }, 'failed'));
        return;
      }
      if (event.name !== AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT
        || voiceCaptionsSuppressedRef.current) return;
      const turnId = typeof event.detail['turn_id'] === 'string'
        ? event.detail['turn_id'].trim()
        : '';
      const voiceId = typeof event.detail['voice_id'] === 'string'
        ? event.detail['voice_id'].trim()
        : '';
      if (!turnId || !voiceId) return;
      const currentBundle = useAvatarStore.getState().bundle;
      const custom = currentBundle?.custom;
      const committedTurnId = typeof custom?.['latest_committed_turn_id'] === 'string'
        ? custom['latest_committed_turn_id'].trim()
        : '';
      const text = typeof custom?.['latest_committed_message_text'] === 'string'
        ? custom['latest_committed_message_text'].trim()
        : '';
      const committedVoiceId = typeof custom?.['last_conversation_voice_id'] === 'string'
        ? custom['last_conversation_voice_id'].trim()
        : '';
      if (!text || committedTurnId !== turnId || committedVoiceId !== voiceId) return;
      const messageId = typeof custom?.['latest_committed_message_id'] === 'string'
        ? custom['latest_committed_message_id'].trim() || null
        : null;
      const at = typeof custom?.['latest_committed_message_at'] === 'string'
        ? custom['latest_committed_message_at'].trim() || event.timestamp
        : event.timestamp;
      activeVoiceCaptionIdRef.current = voiceId;
      setVoice((current) => setVoiceAssistantCaption(current, {
        text,
        at,
        messageId,
        turnId,
        live: false,
      }));
    });
  }, [bootstrapHandle?.driver, companionAnchorKey]);

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
    cancelLocalVoice();
    setVoice((current) => closeVoiceCompanion(current));
  }, [
    cancelLocalVoice,
    composition.ready,
    dismissTransientSurfaces,
    enterLocalQuiet,
  ]);

  useEffect(() => {
    if (!composition.ready) return;
    if (backendPresentation.kind === 'ready') {
      backendWasReadyRef.current = true;
      return;
    }
    setBodyHovered(false);
    setBodyPointerContact(false);
    setFocusVisibleWithinStage(false);
    dismissTransientSurfaces('composition_change');
    if (backendWasReadyRef.current) {
      voiceCaptionsSuppressedRef.current = true;
    }
    cancelLocalVoice();
    setVoice((current) => closeVoiceCompanion(current));
  }, [
    backendPresentation.kind,
    cancelLocalVoice,
    composition.ready,
    dismissTransientSurfaces,
  ]);

  // ── Render: hard mutually exclusive ──────────────────────────────────────────
  const ambient = presentationReady
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
    consumeAuthority: consume.authority,
    presentationState: backendPresentation.kind,
    audio: audioPlayback,
  });
  const committedPresentation = productCompositionReady
    ? bootstrapHandle?.carrier?.committedPresentationSelection ?? null
    : null;

  if (!composition.renderable) {
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
      data-avatar-product-ready={presentationReady ? 'true' : 'false'}
      data-avatar-development-preview={composition.developmentPreview ? 'true' : 'false'}
      data-avatar-presentation-state={backendPresentation.kind}
      data-avatar-presentation-asset-ref={committedPresentation?.avatarAssetRef}
      data-avatar-presentation-backend={committedPresentation?.backendKind}
      data-avatar-presentation-revision={committedPresentation?.presentationRevision}
    >
      <EmbodimentStage
        backend={bootstrapHandle?.carrier?.backend ?? null}
        presentationKey={carrierPresentationKey(bootstrapHandle?.carrier)}
        stagingPresentation={stagedPresentation ? {
          backend: stagedPresentation.carrier.backend,
          presentationKey: stagedPresentation.presentationKey,
          onPresentationStateChange: handleStagedPresentationState,
        } : null}
        windowSize={shell.windowSize ?? { width: 400, height: 600 }}
        embodied={presentationReady}
        interactive={presentationReady}
        reducedMotion={reducedMotion || quietLatched || composition.developmentPreview}
        emit={presentationReady ? handleAvatarOriginEvent : undefined}
        setBodyHovered={setBodyHovered}
        setBodyPointerContact={setBodyPointerContact}
        onAvatarWheel={handleAvatarWheel}
        interactionModality={interactionModality}
        onFocusVisibleChange={setFocusVisibleWithinStage}
        onPresentationStateChange={handleBackendPresentationState}
        onSurfaceBoundsChange={handleBackendSurfaceBounds}
      />
      {presentationReady && shouldMountCompanionSurface(voice) && !quietLatched ? (
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

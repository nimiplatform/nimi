// Avatar shell root component.
// App-local prerequisite composition mounts exactly one of
// embodiment-stage or degraded-surface.
// The retired mixed `recovery panel` + `trigger toggle` paths are
// hard-cut; text/settings controls now move to transient overlays.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import { bootstrapAvatar, type BootstrapHandle } from './app-shell/app-bootstrap.js';
import { useAvatarStore } from './app-shell/app-store.js';
import { setAlwaysOnTop } from './app-shell/avatar-window-commands.js';
import { useWindowBoundsSync } from './app-shell/use-window-bounds-sync.js';
import { isTauriRuntime, onLaunchContextUpdated } from './app-shell/tauri-lifecycle.js';
import { deriveCompositionState, type CompositionDerivation } from './app-shell/composition-state.js';
import { EmbodimentStage } from './embodiment-stage/embodiment-stage.js';
import { DegradedSurface } from './degraded-surface/degraded-surface.js';
import {
  bindCompanionState,
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

export function App() {
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const [bootstrapHandle, setBootstrapHandle] = useState<BootstrapHandle | null>(null);
  const [companion, setCompanion] = useState(initialCompanionState);
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

  const voiceCaptureSessionRef = useRef<AvatarVoiceCaptureSession | null>(null);
  const voiceSubmitAbortRef = useRef<AbortController | null>(null);

  const bundle = useAvatarStore((s) => s.bundle);
  const shell = useAvatarStore((s) => s.shell);
  const model = useAvatarStore((s) => s.model);
  const consume = useAvatarStore((s) => s.consume);
  const driver = useAvatarStore((s) => s.driver);
  const runtimeBinding = useAvatarStore((s) => s.runtime.binding);
  const launchContext = useAvatarStore((s) => s.launch.context);

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
        carrier: bootstrapHandle?.carrier ?? null,
      }),
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
    const agentHandle = normalizeText(consume.agentHandle);
    const conversationAnchorId = normalizeText(consume.conversationAnchorId);
    if (!agentHandle || !conversationAnchorId) return null;
    return { agentHandle, conversationAnchorId };
  }, [consume.agentHandle, consume.conversationAnchorId]);

  const companionAnchorKey = createCompanionAnchorKey(companionBinding);
  const activeTurnCue = useMemo(
    () => readActiveTurnCue(bundle, companionBinding),
    [bundle, companionBinding],
  );

  useEffect(() => {
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
  // Bubble auto-collapse is hard-disabled: the assistant history stays
  // visible until the user explicitly closes it.

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
    overlayNodes,
  } = useAvatarShellOverlays({
    bootstrapHandle,
    companionBinding,
    activeTurnCue,
    consume,
    launchContext,
    shellSettings,
    setShellSettings,
    avatarScale,
    updateAvatarScale,
  });

  // Defensive hover/contact reset when no longer ready.
  useEffect(() => {
    if (composition.ready) return;
    setBodyHovered(false);
    setBodyPointerContact(false);
    setFocusVisibleWithinStage(false);
    dismissTransientSurfaces('composition_change');
    onCloseVoiceMode();
  }, [
    composition.ready,
    dismissTransientSurfaces,
  ]);

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
  const runtimeStatus = deriveAvatarRuntimeStatus({
    compositionReady: composition.ready,
    compositionState: composition.state,
    audio: audioPlayback,
  });

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
    >
      <EmbodimentStage
        backend={bootstrapHandle?.carrier?.backend ?? null}
        windowSize={shell.windowSize ?? { width: 400, height: 600 }}
        embodied={composition.ready}
        emit={handleAvatarOriginEvent}
        setBodyHovered={setBodyHovered}
        setBodyPointerContact={setBodyPointerContact}
        onAvatarWheel={handleAvatarWheel}
        interactionModality={interactionModality}
        onFocusVisibleChange={setFocusVisibleWithinStage}
      />
      <AvatarRuntimeStatusRegion status={runtimeStatus} />
      {overlayNodes}
    </div>
  );
}

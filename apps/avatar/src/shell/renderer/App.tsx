import { useEffect, useMemo, useRef, useState } from 'react';
import { bootstrapAvatar, type BootstrapHandle } from './app-shell/app-bootstrap.js';
import { useAvatarStore } from './app-shell/app-store.js';
import { recordAvatarEvidenceEventually } from './app-shell/avatar-evidence.js';
import { setAlwaysOnTop, startWindowDrag } from './app-shell/tauri-commands.js';
import { isTauriRuntime, onLaunchContextUpdated } from './app-shell/tauri-lifecycle.js';
import {
  beginCompanionSubmit,
  bindCompanionState,
  collapseCompanionBubble,
  completeCompanionSubmit,
  createCompanionAnchorKey,
  dismissCompanionInput,
  failCompanionSubmit,
  ingestAssistantMessage,
  initialCompanionState,
  openCompanionInput,
  readActiveTurnCue,
  readLatestAssistantMessage,
  readTurnTerminalCue,
  setCompanionDraft,
  type CompanionAnchorBinding,
} from './companion-state.js';
import { deriveSurfacePresentation } from './surface-presentation.js';
import {
  beginVoiceListening,
  beginVoiceTranscribing,
  bindVoiceCompanionState,
  closeVoiceCompanion,
  completeVoiceReplying,
  initialVoiceCompanionState,
  interruptVoiceCompanion,
  openVoiceCompanion,
  setVoiceAssistantCaption,
  setVoiceCompanionAvailability,
  setVoiceCompanionError,
  setVoiceLevel,
  setVoiceReplyingTurn,
  setVoiceTranscriptSubmitted,
} from './voice-companion-state.js';
import { defaultAvatarShellSettings, readAvatarShellSettings, writeAvatarShellSettings, type AvatarShellSettings } from './settings-state.js';
import { reloadAvatarShell } from './shell-reload.js';
import { AvatarShellView } from './avatar-shell-view.js';
import { createAbortError, normalizeText, shortenId, toErrorMessage } from './avatar-shell-utils.js';
export function App() {
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const [bootstrapHandle, setBootstrapHandle] = useState<BootstrapHandle | null>(null);
  const [companion, setCompanion] = useState(initialCompanionState);
  const [voice, setVoice] = useState(initialVoiceCompanionState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [interactionModality, setInteractionModality] = useState<'keyboard' | 'pointer'>('pointer');
  const [bodyHovered, setBodyHovered] = useState(false);
  const [bodyPointerContact, setBodyPointerContact] = useState(false);
  const [focusVisibleWithinStage, setFocusVisibleWithinStage] = useState(false);
  const [shellSettings, setShellSettings] = useState<AvatarShellSettings>(() => readAvatarShellSettings());
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [relaunchNotice, setRelaunchNotice] = useState<{
    title: string;
    summary: string;
  } | null>(null);
  const voiceCaptureSessionRef = useRef<Awaited<ReturnType<BootstrapHandle['startVoiceCapture']>> | null>(null);
  const voiceSubmitAbortRef = useRef<AbortController | null>(null);
  const voiceOperationCounterRef = useRef(0);
  const voiceOperationRef = useRef<{ id: number; anchorKey: string | null } | null>(null);
  const currentAnchorKeyRef = useRef<string | null>(null);
  const unmountedRef = useRef(false);
  const relaunchTimerRef = useRef<number | null>(null);
  const stageInteractionRef = useRef<HTMLElement | null>(null);
  const bundle = useAvatarStore((s) => s.bundle);
  const shell = useAvatarStore((s) => s.shell);
  const model = useAvatarStore((s) => s.model);
  const driver = useAvatarStore((s) => s.driver);
  const consume = useAvatarStore((s) => s.consume);
  const runtimeBinding = useAvatarStore((s) => s.runtime.binding);
  const launchContext = useAvatarStore((s) => s.launch.context);
  const persistShellSettings = (next: AvatarShellSettings): void => {
    setShellSettings(next);
    writeAvatarShellSettings(next);
  };
  const applyAlwaysOnTopSetting = (nextValue: boolean): void => {
    const previousValue = shellSettings.alwaysOnTop;
    const nextSettings = {
      ...shellSettings,
      alwaysOnTop: nextValue,
    };
    persistShellSettings(nextSettings);
    useAvatarStore.getState().setAlwaysOnTop(nextValue);
    setSettingsError(null);
    if (!isTauriRuntime()) {
      return;
    }
    void setAlwaysOnTop(nextValue).catch((error: unknown) => {
      persistShellSettings({
        ...nextSettings,
        alwaysOnTop: previousValue,
      });
      useAvatarStore.getState().setAlwaysOnTop(previousValue);
      setSettingsError(`Unable to update always-on-top right now: ${toErrorMessage(error)}`);
    });
  };
  const clearRelaunchTimer = (): void => {
    if (relaunchTimerRef.current !== null) {
      window.clearTimeout(relaunchTimerRef.current);
      relaunchTimerRef.current = null;
    }
  };
  const abortVoiceInteraction = (): void => {
    voiceOperationRef.current = null;
    voiceCaptureSessionRef.current?.cancel();
    voiceCaptureSessionRef.current = null;
    voiceSubmitAbortRef.current?.abort();
    voiceSubmitAbortRef.current = null;
  };
  const resetTransientSurfaceState = (): void => {
    abortVoiceInteraction();
    setCompanion(initialCompanionState);
    setVoice(initialVoiceCompanionState);
  };
  const scheduleShellReload = (input: {
    title: string;
    summary: string;
  }): void => {
    resetTransientSurfaceState();
    setSettingsOpen(false);
    setRelaunchNotice(input);
    if (relaunchTimerRef.current !== null) {
      return;
    }
    relaunchTimerRef.current = window.setTimeout(() => {
      relaunchTimerRef.current = null;
      reloadAvatarShell();
    }, 900);
  };
  useEffect(() => {
    useAvatarStore.getState().setAlwaysOnTop(shellSettings.alwaysOnTop);
  }, [shellSettings.alwaysOnTop]);
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    recordAvatarEvidenceEventually({
      kind: 'avatar.renderer.boot',
      detail: {
        source: 'avatar-renderer',
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      },
    });
  }, []);
  useEffect(() => {
    const handleKeyDown = (): void => {
      setInteractionModality('keyboard');
    };
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
      unmountedRef.current = true;
      clearRelaunchTimer();
      voiceOperationRef.current = null;
      voiceCaptureSessionRef.current?.cancel();
      voiceCaptureSessionRef.current = null;
      voiceSubmitAbortRef.current?.abort();
      voiceSubmitAbortRef.current = null;
      setBootstrapHandle(null);
      void handle?.shutdown();
    };
  }, []);
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let active = true;
    let unlisten: (() => void) | null = null;
    void onLaunchContextUpdated((payload) => {
      if (!active) {
        return;
      }
      useAvatarStore.getState().setLaunchContext(payload);
      const reboundAnchor = payload.conversationAnchorId
        ? shortenId(payload.conversationAnchorId)
        : 'new anchor';
      scheduleShellReload({
        title: 'Desktop update received',
        summary: `Rebinding this shell to ${shortenId(payload.agentId)} / ${reboundAnchor}. Runtime interaction stays closed until the new handoff is live.`,
      });
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
  const presentation = deriveSurfacePresentation({
    bootstrapError,
	    bootstrapComplete,
	    shell,
	    model,
	    driver,
	    consume,
	    runtimeBinding,
	    launchContext,
	    bundle,
	  });
  const companionBinding = useMemo<CompanionAnchorBinding | null>(() => {
    const agentId = normalizeText(consume.agentId);
    const conversationAnchorId = normalizeText(consume.conversationAnchorId);
    if (!agentId || !conversationAnchorId) {
      return null;
    }
    return {
      agentId,
      conversationAnchorId,
    };
  }, [consume.agentId, consume.conversationAnchorId]);
  const companionAnchorKey = createCompanionAnchorKey(companionBinding);
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
  const companionAvailable = Boolean(
	    bootstrapHandle
	    && companionBinding
	    && consume.authority === 'runtime'
	    && runtimeBinding.status === 'active'
	    && presentation.tone === 'ready'
	    && !relaunchNotice,
	  );
  const companionBusy = companion.sendState === 'sending' || bundle?.execution_state === 'CHAT_ACTIVE';
  const companionVisible = companion.bubbleVisible || companion.inputVisible || voice.panelVisible;
  const visualEmbodimentReady = model.loadState === 'loaded' && Boolean(bootstrapHandle?.carrier?.backendSession);
  const embodiedSurfaceReady = companionAvailable || visualEmbodimentReady;
  useEffect(() => {
    if (embodiedSurfaceReady) {
      return;
    }
    setBodyHovered(false);
    setBodyPointerContact(false);
    setFocusVisibleWithinStage(false);
  }, [embodiedSurfaceReady]);
  useEffect(() => {
    if (!bodyPointerContact) {
      return;
    }
    const clearPointerContact = (): void => {
      setBodyPointerContact(false);
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') {
        setBodyPointerContact(false);
      }
    };
    window.addEventListener('pointerup', clearPointerContact, true);
    window.addEventListener('pointercancel', clearPointerContact, true);
    window.addEventListener('blur', clearPointerContact);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pointerup', clearPointerContact, true);
      window.removeEventListener('pointercancel', clearPointerContact, true);
      window.removeEventListener('blur', clearPointerContact);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [bodyPointerContact]);
  const isVoiceOperationCurrent = (operationId: number, anchorKey: string | null): boolean => (
    !unmountedRef.current
    && currentAnchorKeyRef.current === anchorKey
    && voiceOperationRef.current?.id === operationId
    && voiceOperationRef.current?.anchorKey === anchorKey
  );
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
	  useEffect(() => {
	    if (runtimeBinding.status === 'active') {
	      return;
	    }
	    resetTransientSurfaceState();
	  }, [runtimeBinding.status]);
  useEffect(() => {
    if (!companionAvailable || !bootstrapHandle || !companionBinding) {
      return;
    }
    let cancelled = false;
    setVoice((current) => setVoiceCompanionAvailability(
      bindVoiceCompanionState(current, companionBinding),
      { availability: 'unknown', message: null },
    ));
    void bootstrapHandle.getVoiceInputAvailability({
      agentId: companionBinding.agentId,
      conversationAnchorId: companionBinding.conversationAnchorId,
    }).then((result) => {
      if (cancelled) {
        return;
      }
      setVoice((current) => setVoiceCompanionAvailability(
        bindVoiceCompanionState(current, companionBinding),
        {
          availability: result.available ? 'ready' : 'blocked',
          message: result.reason,
        },
      ));
    });
    return () => {
      cancelled = true;
    };
  }, [bootstrapHandle, companionAvailable, companionAnchorKey, companionBinding]);
  useEffect(() => {
    if (!latestAssistantMessage) {
      return;
    }
    setCompanion((current) => {
      const next = bindCompanionState(current, companionBinding);
      if (!next.anchorKey || !companionBinding) {
        return next;
      }
      if (
        next.latestAssistantMessage?.messageId === latestAssistantMessage.messageId
        && next.latestAssistantMessage?.at === latestAssistantMessage.at
        && next.latestAssistantMessage?.text === latestAssistantMessage.text
      ) {
        return next;
      }
      const revealImmediately = shellSettings.bubbleAutoOpen
        || next.bubbleVisible
        || next.inputVisible
        || next.sendState === 'sending'
        || voice.panelVisible;
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
    voice.panelVisible,
  ]);
  useEffect(() => {
    setVoice((current) => {
      let next = bindVoiceCompanionState(current, companionBinding);
      if (!next.anchorKey) {
        return next;
      }
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
        next = setVoiceAssistantCaption(next, {
          ...latestAssistantMessage,
          live: false,
        });
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
  useEffect(() => {
    if (!shellSettings.bubbleAutoCollapse) {
      return;
    }
    if (
      !companion.bubbleVisible
      || companion.inputVisible
      || companion.sendState === 'sending'
      || voice.panelVisible
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCompanion((current) => collapseCompanionBubble(current));
    }, 9000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    companion.bubbleVisible,
    companion.inputVisible,
    companion.sendState,
    companion.latestAssistantMessage?.at,
    companion.latestUserCue?.at,
    shellSettings.bubbleAutoCollapse,
    voice.panelVisible,
  ]);
  const showRecoveryPanel = Boolean(
    relaunchNotice
    || settingsError
    || (presentation.tone !== 'ready' && !visualEmbodimentReady),
  );
  const showShellControlsPanel = Boolean(settingsOpen || !visualEmbodimentReady);
	  const showSurfaceStatusCopy = Boolean(
	    showRecoveryPanel
	    || companionAvailable
	    || consume.authority === 'fixture'
	    || runtimeBinding.status !== 'active',
	  );
  const displayPresentation = relaunchNotice
    ? {
      tone: 'degraded' as const,
      badge: 'Rebinding',
      title: relaunchNotice.title,
      summary: relaunchNotice.summary,
      recovery: 'Reload this shell to bind the new desktop-selected context. No prior ready/bound state is kept alive locally.',
      accent: 'Rebinding',
      stageLabel: 'Launch update',
      stageValue: 'Rebinding',
      meta: [] as Array<{ label: string; value: string }>,
      contextCards: [] as Array<{ label: string; value: string }>,
    }
    : presentation;
  const recoveryTitle = relaunchNotice?.title
    || (settingsError
      ? 'Shell settings need attention'
      : presentation.tone === 'loading'
        ? 'Bring-up posture'
        : 'Recovery posture');
  const recoverySummary = relaunchNotice?.summary
    || settingsError
    || presentation.summary;
  const recoveryGuidance = relaunchNotice
    ? 'Reload this shell to bind the new desktop-selected context. No prior ready or bound state is kept alive locally.'
    : settingsError
      ? 'Reload this shell to reopen a clean shell-local settings surface for the admitted controls only.'
      : presentation.recovery;
  const recoveryHint = relaunchNotice
    ? 'Local draft, unread cue, and foreground voice capture or caption state clear before this shell binds the next desktop-selected context.'
    : settingsError
      ? 'This only resets avatar-shell-local controls. Launch and runtime truth remain upstream.'
      : 'Reloading this shell only clears avatar-local transient state. Desktop launch and runtime decide whether the next bind is allowed.';
  const recoveryChecklist = relaunchNotice
    ? [
      'Clears local draft, unread cue, and foreground voice capture or caption state before rebinding.',
      'Does not invent runtime fallback inside the avatar app.',
    ]
    : settingsError
      ? [
        'Reopens a clean surface for the four admitted avatar-shell-local controls.',
        'Does not bypass desktop launch or runtime requirements.',
      ]
      : [
        'Reloads this avatar shell only. No in-app runtime repair is attempted.',
        'Clears avatar-local draft, unread cue, and foreground voice state before the next bind.',
      ];
  const shellControlSummary = 'Four avatar-shell behaviors only. Launch and runtime stay upstream.';
  const shellControlHint = settingsOpen
    ? 'The toggles below change only this shell. They never open transcript history, background voice, or desktop-side repair.'
    : 'Open shell settings to review or change these four local behaviors without turning the avatar into a larger preferences panel.';
  const shellControlEffects = [
    {
      label: 'Window stack',
      value: shellSettings.alwaysOnTop ? 'Pinned above other windows' : 'Moves with the normal window stack',
      detail: shellSettings.alwaysOnTop
        ? 'Focus still follows the active app. Always-on-top is not focus.'
        : 'Launch and runtime posture stay unchanged.',
    },
    {
      label: 'Fresh replies',
      value: shellSettings.bubbleAutoOpen
        ? 'Open immediately inside the companion'
        : 'Hold as an unread cue until you open them',
      detail: 'Reply continuity stays on the same explicit anchor either way.',
    },
    {
      label: 'Quiet bubble',
      value: shellSettings.bubbleAutoCollapse
        ? 'Settles after a calm delay'
        : 'Stays open until you close it',
      detail: 'Only bubble visibility changes. No history or detached thread view appears.',
    },
    {
      label: 'Foreground voice captions',
      value: shellSettings.showVoiceCaptions
        ? 'Visible during foreground turns'
        : 'Hidden while continuity stays truthful',
      detail: 'This affects bounded foreground captions only, not background voice.',
    },
  ] as const;
  const voiceModeLocked = voice.status === 'listening'
    || voice.status === 'transcribing'
    || voice.status === 'pending'
    || voice.status === 'replying';
  const textModeLocked = companion.sendState === 'sending';
  const voiceUnavailable = voice.availability === 'blocked';
  const hasActiveReplyEvidence = Boolean(normalizeText(activeTurnCue?.turnId));
  const activeReplyPreview = normalizeText(activeTurnCue?.text);
  const textModeActive = companion.inputVisible && !voice.panelVisible;
  const voiceModeActive = voice.panelVisible;
  const summaryMode = !textModeActive && !voiceModeActive;
  const canSwitchToTextMode = companionAvailable && !voiceModeLocked;
  const canSwitchToVoiceMode = companionAvailable && !textModeLocked;
  const companionStatusTone = voiceModeActive && voiceUnavailable
    ? 'alert'
    : voice.status === 'error' || voice.status === 'interrupted'
      ? 'alert'
      : voice.status === 'pending' || voice.status === 'transcribing' || companion.sendState === 'sending'
        ? 'waiting'
      : voice.status === 'listening' || voice.status === 'replying'
          ? 'live'
          : summaryMode && hasActiveReplyEvidence
            ? 'live'
          : textModeActive || companion.latestAssistantMessage
            ? 'active'
            : companionBusy
              ? 'waiting'
              : 'quiet';
  const companionStatusLabel = voiceModeActive && voiceUnavailable
    ? 'Voice unavailable'
    : voice.status === 'listening'
      ? 'Listening'
      : voice.status === 'transcribing'
        ? 'Transcribing'
        : voice.status === 'pending'
          ? 'Reply pending'
          : voice.status === 'replying'
            ? 'Reply active'
            : voice.status === 'interrupted'
              ? 'Interrupted'
              : voice.status === 'error'
                ? 'Voice blocked'
                : companion.sendState === 'sending'
                  ? 'Sending note'
                  : summaryMode && hasActiveReplyEvidence
                    ? 'Reply active'
                  : textModeActive
                    ? 'Text note'
                    : companion.latestAssistantMessage
                      ? 'Latest reply'
                      : companionBusy
                        ? 'Reply pending'
                        : 'Anchor ready';
  const companionTitle = textModeActive
    ? 'Text note on current anchor'
    : voiceModeActive
      ? (
        voice.status === 'listening'
          ? 'Listening on current anchor'
          : voice.status === 'transcribing'
            ? 'Transcribing current anchor audio'
            : voice.status === 'pending'
              ? 'Reply pending on current anchor'
              : voice.status === 'replying'
                ? 'Reply active on current anchor'
                : voice.status === 'interrupted'
                  ? 'Current anchor reply interrupted'
                  : voice.status === 'error' || voiceUnavailable
                    ? 'Foreground voice unavailable'
                    : 'Foreground voice companion'
      )
      : summaryMode && hasActiveReplyEvidence
        ? 'Reply active on current anchor'
      : companion.latestAssistantMessage
        ? 'Latest anchor reply'
        : companionBusy
          ? 'Waiting on current anchor'
          : 'Anchor companion';
  const companionBody = textModeActive
    ? (
      companion.sendState === 'sending'
        ? 'Sending a bounded note on the current anchor. Reply truth still waits for authoritative evidence.'
        : normalizeText(companion.draft)
          ? 'This draft stays bounded to the current explicit anchor. Foreground voice remains a separate explicit action inside the same companion.'
          : 'Type a bounded note without leaving this anchor-bound companion surface.'
    )
    : voiceModeActive
      ? (
        voiceUnavailable
          ? (voice.availabilityMessage || 'Foreground voice is unavailable for this anchor. Text note stays available inside the same companion.')
          : voice.status === 'listening'
            ? 'Microphone capture is foreground-only and bound to this explicit agent and conversation anchor.'
            : voice.status === 'transcribing'
              ? 'Recorded audio is being transcribed before it re-enters the same anchor continuity.'
              : voice.status === 'pending'
                ? 'Transcript submitted on the current anchor. Interrupt stays closed until the active reply is authoritatively surfaced.'
                : voice.status === 'replying'
                  ? 'The current anchor reply is active. Captions stay bounded to the current turn.'
                : voice.status === 'interrupted'
                  ? 'The previous foreground reply stopped. You can listen again or return to text without leaving this anchor.'
                  : voice.errorMessage
                    || 'Foreground voice stays explicit to this avatar launch. No wake-word, no background continuation.'
      )
      : summaryMode && hasActiveReplyEvidence
        ? (activeReplyPreview || 'The current anchor reply is active. Open foreground voice to follow bounded live captions or interrupt on this same anchor.')
      : companion.latestAssistantMessage?.text
        || (companionBusy
          ? 'The current anchor is active. Stay in this companion surface while reply evidence arrives.'
          : 'Stay on this anchor. Type a bounded note or start a foreground voice turn from the same companion surface.');
  const voicePrimaryActionLabel = voiceUnavailable
    ? 'Voice unavailable'
    : voice.status === 'listening'
      ? 'Send voice'
      : voice.status === 'transcribing'
        ? 'Transcribing...'
        : voice.status === 'pending'
          ? 'Reply pending'
          : voice.status === 'replying'
            ? 'Reply active'
            : voice.status === 'interrupted'
              ? 'Listen again'
              : voice.status === 'error'
                ? 'Retry voice'
                : 'Start listening';
  const voicePrimaryActionDisabled = !bootstrapHandle
    || !companionBinding
    || voice.status === 'transcribing'
    || voice.status === 'pending'
    || voice.status === 'replying'
    || (voice.status === 'idle' && voice.availability !== 'ready')
    || (voice.status === 'error' && voice.availability !== 'ready');
  const canInterruptVoiceReply = Boolean(
    bootstrapHandle
    && companionBinding
    && voice.status === 'replying'
    && normalizeText(activeTurnCue?.turnId || voice.currentTurnId),
  );
  const openTextMode = (): void => {
    if (!canSwitchToTextMode) {
      return;
    }
    abortVoiceInteraction();
    setVoice((current) => closeVoiceCompanion(current));
    setCompanion((current) => openCompanionInput(current));
  };
  const openVoiceMode = (): void => {
    if (!canSwitchToVoiceMode) {
      return;
    }
    setCompanion((current) => ({
      ...dismissCompanionInput(current),
      bubbleVisible: true,
      unread: false,
      sendError: null,
    }));
    setVoice((current) => openVoiceCompanion(current));
  };
  const closeCompanionSurface = (): void => {
    abortVoiceInteraction();
    setVoice((current) => closeVoiceCompanion(current));
    setCompanion((current) => collapseCompanionBubble(dismissCompanionInput(current)));
  };
  const closeVoiceMode = (): void => {
    abortVoiceInteraction();
    setVoice((current) => closeVoiceCompanion(current));
    setCompanion((current) => ({
      ...dismissCompanionInput(current),
      bubbleVisible: true,
      unread: false,
      sendError: null,
    }));
  };
  const ambientMode = !embodiedSurfaceReady
    ? 'damped'
    : companion.unread
      ? 'unread'
      : companionVisible
        ? 'engaged'
        : 'ready';
  const shellClassName = [
    `avatar-shell avatar-shell--${displayPresentation.tone}`,
    `avatar-shell--ambient-${ambientMode}`,
  ].join(' ');
  const stageClassName = [
    'avatar-stage',
    companionVisible ? 'avatar-stage--overlay-open' : '',
    embodiedSurfaceReady ? 'avatar-stage--embodied' : 'avatar-stage--attention-muted',
    ambientMode === 'ready' ? 'avatar-stage--attention-ready' : '',
    ambientMode === 'engaged' ? 'avatar-stage--attention-engaged' : '',
    ambientMode === 'unread' ? 'avatar-stage--attention-unread' : '',
    bodyHovered ? 'avatar-stage--body-hover' : '',
    bodyPointerContact ? 'avatar-stage--pointer-contact' : '',
    focusVisibleWithinStage ? 'avatar-stage--focus-visible' : '',
  ].filter(Boolean).join(' ');
  const triggerRowClassName = [
    'avatar-companion-trigger-row',
    ambientMode === 'engaged' ? 'avatar-companion-trigger-row--engaged' : '',
    ambientMode === 'unread' ? 'avatar-companion-trigger-row--unread' : '',
    bodyPointerContact ? 'avatar-companion-trigger-row--pointer-contact' : '',
    focusVisibleWithinStage ? 'avatar-companion-trigger-row--focus-visible' : '',
  ].filter(Boolean).join(' ');
  const companionClassName = [
    'avatar-companion',
    companionVisible ? 'avatar-companion--engaged' : '',
    textModeActive ? 'avatar-companion--text' : '',
    voice.panelVisible ? 'avatar-companion--voice' : '',
    ambientMode === 'unread' ? 'avatar-companion--attention-unread' : '',
    focusVisibleWithinStage ? 'avatar-companion--focus-visible' : '',
  ].filter(Boolean).join(' ');
  return <AvatarShellView {...{ activeTurnCue, applyAlwaysOnTopSetting, beginVoiceOperation, bootstrapHandle, canInterruptVoiceReply, canSwitchToTextMode, canSwitchToVoiceMode, clearVoiceOperation, closeCompanionSurface, closeVoiceMode, companion, companionAvailable, companionBinding, companionBody, companionBusy, companionClassName, companionStatusLabel, companionStatusTone, companionTitle, companionVisible, displayPresentation, embodiedSurfaceReady, focusVisibleWithinStage, interactionModality, openTextMode, openVoiceMode, persistShellSettings, presentation, recoveryChecklist, recoveryGuidance, recoveryHint, recoverySummary, recoveryTitle, relaunchNotice, settingsError, settingsOpen, setBodyHovered, setBodyPointerContact, setCompanion, setFocusVisibleWithinStage, setSettingsError, setSettingsOpen, setVoice, shell, shellClassName, shellControlEffects, shellControlHint, shellControlSummary, shellSettings, showRecoveryPanel, showShellControlsPanel, showSurfaceStatusCopy, stageClassName, stageInteractionRef, textModeActive, triggerRowClassName, voice, voiceCaptureSessionRef, voiceModeActive, voicePrimaryActionDisabled, voicePrimaryActionLabel, voiceSubmitAbortRef, voiceUnavailable, isVoiceOperationCurrent, companionAnchorKey }} />;}

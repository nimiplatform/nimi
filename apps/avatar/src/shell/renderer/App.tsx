import { useEffect, useMemo, useRef, useState } from 'react';
import { bootstrapAvatar, type BootstrapHandle } from './app-shell/app-bootstrap.js';
import { useAvatarStore } from './app-shell/app-store.js';
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
import {
  defaultAvatarShellSettings,
  readAvatarShellSettings,
  writeAvatarShellSettings,
  type AvatarShellSettings,
} from './settings-state.js';
import { reloadAvatarShell } from './shell-reload.js';

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim();
}

function shortenId(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 'Unavailable';
  }
  return normalized.length > 16
    ? `${normalized.slice(0, 8)}…${normalized.slice(-4)}`
    : normalized;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createAbortError(): Error {
  const error = new Error('Foreground voice request aborted.');
  error.name = 'AbortError';
  return error;
}

export function App() {
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const [bootstrapHandle, setBootstrapHandle] = useState<BootstrapHandle | null>(null);
  const [companion, setCompanion] = useState(initialCompanionState);
  const [voice, setVoice] = useState(initialVoiceCompanionState);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const bundle = useAvatarStore((s) => s.bundle);
  const shell = useAvatarStore((s) => s.shell);
  const model = useAvatarStore((s) => s.model);
  const driver = useAvatarStore((s) => s.driver);
  const consume = useAvatarStore((s) => s.consume);
  const auth = useAvatarStore((s) => s.auth);
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
        summary: `Rebinding this shell to ${shortenId(payload.agentId)} / ${reboundAnchor}. Runtime and auth truth stay fail-closed until the new handoff is live.`,
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
    auth,
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
    && auth.status === 'authenticated'
    && presentation.tone === 'ready'
    && !relaunchNotice,
  );
  const companionBusy = companion.sendState === 'sending' || bundle?.execution_state === 'CHAT_ACTIVE';
  const companionVisible = companion.bubbleVisible || companion.inputVisible || voice.panelVisible;

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

  const showRecoveryPanel = Boolean(relaunchNotice || settingsError || presentation.tone !== 'ready');
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
    || (settingsError ? 'Shell settings need attention' : 'Recovery posture');
  const recoverySummary = relaunchNotice?.summary
    || settingsError
    || presentation.recovery;
  const recoveryHint = relaunchNotice
    ? 'This handoff refresh does not invent local fallback state. The shell reloads so the next desktop-selected context can bind cleanly.'
    : presentation.tone === 'ready'
      ? 'Only app-local shell settings changed. Launch, auth, and runtime truth remain upstream.'
      : 'Reloading the shell does not soften fail-closed posture. Recovery still depends on desktop launch context, shared auth, and runtime readiness.';

  const companionTitle = voice.panelVisible
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
              : voice.status === 'error'
                ? 'Foreground voice unavailable'
                : 'Foreground voice companion'
    )
    : companion.latestAssistantMessage
      ? 'Latest anchor reply'
      : companionBusy
        ? 'Waiting on current anchor'
        : 'Anchor-bound quick note';
  const companionBody = voice.panelVisible
    ? (
      voice.availability === 'blocked'
        ? (voice.availabilityMessage || 'Foreground voice is unavailable for this anchor.')
        : voice.status === 'listening'
          ? 'Microphone capture is foreground-only and bound to this explicit agent and conversation anchor.'
          : voice.status === 'transcribing'
            ? 'Recorded audio is being transcribed before it re-enters the same anchor continuity.'
            : voice.status === 'pending'
              ? 'Transcript submitted on the current anchor. Interrupt stays closed until the active reply is authoritatively surfaced.'
              : voice.status === 'replying'
                ? 'The current anchor reply is active. Captions stay bounded to the current turn.'
              : voice.status === 'interrupted'
                ? 'The previous foreground reply stopped. You can listen again without leaving this anchor.'
                : voice.errorMessage
                  || 'Foreground voice stays explicit to this avatar launch. No wake-word, no background continuation.'
    )
    : companion.latestAssistantMessage?.text
      || (companionBusy
        ? 'The current anchor is active. Keep the companion open for the next reply.'
        : 'Send a lightweight note without leaving the avatar surface.');

  const voicePrimaryActionLabel = voice.status === 'listening'
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

  return (
    <div className="avatar-root">
      <div
        className={`avatar-shell avatar-shell--${displayPresentation.tone}`}
        onPointerDown={(event) => {
          if (isTauriRuntime() && event.button === 0) {
            void startWindowDrag();
          }
        }}
        role="presentation"
      >
        <div className="avatar-shell__halo avatar-shell__halo--outer" />
        <div className="avatar-shell__halo avatar-shell__halo--inner" />
        <section className="avatar-stage">
          <div className="avatar-stage__backdrop" />
          <div className="avatar-stage__orbit avatar-stage__orbit--one" />
          <div className="avatar-stage__orbit avatar-stage__orbit--two" />
          <div className="avatar-stage__body">
            <div className="avatar-stage__glow" />
            <div className="avatar-stage__core">
              <span className="avatar-stage__label">{displayPresentation.stageLabel}</span>
              <strong className="avatar-stage__value">{displayPresentation.stageValue}</strong>
            </div>
          </div>
          {companionAvailable ? (
            <>
              <div className="avatar-companion-trigger-row">
                <button
                  type="button"
                  className={`avatar-companion-trigger${companion.unread ? ' avatar-companion-trigger--unread' : ''}`}
                  onClick={() => {
                    setCompanion((current) => openCompanionInput(current));
                  }}
                  aria-label="Open avatar companion input"
                >
                  <span className="avatar-companion-trigger__icon">+</span>
                  <span className="avatar-companion-trigger__label">Chat</span>
                </button>
                <button
                  type="button"
                  className={`avatar-companion-trigger avatar-companion-trigger--voice${voice.panelVisible ? ' avatar-companion-trigger--active' : ''}`}
                  onClick={() => {
                    setCompanion((current) => ({
                      ...current,
                      bubbleVisible: true,
                      unread: false,
                    }));
                    setVoice((current) => openVoiceCompanion(current));
                  }}
                  aria-label="Open avatar voice companion"
                >
                  <span className="avatar-companion-trigger__icon">o</span>
                  <span className="avatar-companion-trigger__label">Voice</span>
                </button>
              </div>

              {companionVisible ? (
                <section className="avatar-companion" aria-label="Avatar companion bubble">
                  <header className="avatar-companion__header">
                    <div>
                      <p className="avatar-companion__eyebrow">{companionTitle}</p>
                      <strong className="avatar-companion__anchor">
                        {shortenId(companionBinding?.agentId)} / {shortenId(companionBinding?.conversationAnchorId)}
                      </strong>
                    </div>
                    <button
                      type="button"
                      className="avatar-companion__close"
                      onClick={() => {
                        abortVoiceInteraction();
                        setVoice((current) => closeVoiceCompanion(current));
                        setCompanion((current) => collapseCompanionBubble(dismissCompanionInput(current)));
                      }}
                      aria-label="Collapse companion bubble"
                    >
                      x
                    </button>
                  </header>

                  <p className="avatar-companion__message">{companionBody}</p>

                  {voice.panelVisible ? (
                    <section className="avatar-voice" aria-label="Foreground voice companion">
                      <div className="avatar-voice__status">
                        <span className={`avatar-voice__badge avatar-voice__badge--${voice.status}`}>
                          {voice.status}
                        </span>
                        <span className="avatar-voice__hint">
                          same-anchor continuity: {shortenId(companionBinding?.conversationAnchorId)}
                        </span>
                      </div>

                      <div className="avatar-voice__meter" aria-hidden="true">
                        <span
                          className="avatar-voice__meter-fill"
                          style={{ transform: `scaleX(${Math.max(0.04, voice.level)})` }}
                        />
                      </div>

                      {shellSettings.showVoiceCaptions && voice.userCaption ? (
                        <div className="avatar-voice__caption">
                          <span className="avatar-voice__caption-label">You said</span>
                          <p className="avatar-voice__caption-text">{voice.userCaption.text}</p>
                        </div>
                      ) : null}

                      {shellSettings.showVoiceCaptions && voice.assistantCaption ? (
                        <div className={`avatar-voice__caption${voice.assistantCaption.live ? ' avatar-voice__caption--live' : ''}`}>
                          <span className="avatar-voice__caption-label">
                            Assistant{voice.assistantCaption.live ? ' (live)' : ''}
                          </span>
                          <p className="avatar-voice__caption-text">{voice.assistantCaption.text}</p>
                        </div>
                      ) : null}

                      {!shellSettings.showVoiceCaptions && (voice.userCaption || voice.assistantCaption) ? (
                        <p className="avatar-companion__hint">
                          Voice captions are hidden in this shell&apos;s settings. Foreground voice continuity remains bound to the current anchor.
                        </p>
                      ) : null}

                      {voice.errorMessage && voice.status !== 'idle' ? (
                        <p className="avatar-companion__error">{voice.errorMessage}</p>
                      ) : null}

                      <div className="avatar-companion__actions">
                        <button
                          type="button"
                          className="avatar-companion__send"
                          disabled={voicePrimaryActionDisabled}
                          onClick={() => {
                            if (!bootstrapHandle || !companionBinding) {
                              return;
                            }

                            if (voice.status === 'listening') {
                              const activeSession = voiceCaptureSessionRef.current;
                              if (!activeSession) {
                                setVoice((current) => setVoiceCompanionError(current, 'Foreground voice capture is no longer active.'));
                                return;
                              }
                              const operationAnchorKey = companionAnchorKey;
                              const operationId = beginVoiceOperation(operationAnchorKey);
                              voiceCaptureSessionRef.current = null;
                              setVoice((current) => beginVoiceTranscribing(current));
                              const abortController = new AbortController();
                              voiceSubmitAbortRef.current = abortController;
                              void activeSession.stop().then((recording) => {
                                if (
                                  !isVoiceOperationCurrent(operationId, operationAnchorKey)
                                  || abortController.signal.aborted
                                ) {
                                  throw createAbortError();
                                }
                                return bootstrapHandle.submitVoiceCaptureTurn({
                                  agentId: companionBinding.agentId,
                                  conversationAnchorId: companionBinding.conversationAnchorId,
                                  audioBytes: recording.bytes,
                                  mimeType: recording.mimeType,
                                  language: navigator.language || 'en-US',
                                  signal: abortController.signal,
                                });
                              }).then((result) => {
                                if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) {
                                  return;
                                }
                                setVoice((current) => setVoiceTranscriptSubmitted(current, {
                                  transcript: result.transcript,
                                  at: new Date().toISOString(),
                                }));
                              }).catch((error: unknown) => {
                                if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) {
                                  return;
                                }
                                if ((error as Error | null)?.name === 'AbortError') {
                                  return;
                                }
                                setVoice((current) => setVoiceCompanionError(current, toErrorMessage(error)));
                              }).finally(() => {
                                if (voiceSubmitAbortRef.current === abortController) {
                                  voiceSubmitAbortRef.current = null;
                                }
                                clearVoiceOperation(operationId, operationAnchorKey);
                              });
                              return;
                            }

                            setCompanion((current) => ({
                              ...current,
                              bubbleVisible: true,
                              unread: false,
                            }));
                            setVoice((current) => beginVoiceListening(current));
                            const operationAnchorKey = companionAnchorKey;
                            const operationId = beginVoiceOperation(operationAnchorKey);
                            void bootstrapHandle.startVoiceCapture({
                              agentId: companionBinding.agentId,
                              conversationAnchorId: companionBinding.conversationAnchorId,
                              onLevelChange: (amplitude) => {
                                if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) {
                                  return;
                                }
                                setVoice((current) => setVoiceLevel(current, amplitude));
                              },
                            }).then((session) => {
                              if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) {
                                session.cancel();
                                return;
                              }
                              voiceCaptureSessionRef.current = session;
                            }).catch((error: unknown) => {
                              if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) {
                                return;
                              }
                              voiceCaptureSessionRef.current = null;
                              clearVoiceOperation(operationId, operationAnchorKey);
                              setVoice((current) => setVoiceCompanionError(current, toErrorMessage(error)));
                            });
                          }}
                        >
                          {voicePrimaryActionLabel}
                        </button>

                        {canInterruptVoiceReply ? (
                          <button
                            type="button"
                            className="avatar-companion__ghost"
                            onClick={() => {
                              if (!bootstrapHandle || !companionBinding) {
                                return;
                              }
                              void bootstrapHandle.interruptTurn({
                                agentId: companionBinding.agentId,
                                conversationAnchorId: companionBinding.conversationAnchorId,
                                turnId: activeTurnCue?.turnId || voice.currentTurnId || undefined,
                                reason: 'avatar_voice_interrupt',
                              }).catch((error: unknown) => {
                                setVoice((current) => setVoiceCompanionError(current, toErrorMessage(error)));
                              });
                            }}
                          >
                            Interrupt
                          </button>
                        ) : null}

                        {(voice.status === 'listening'
                          || voice.status === 'transcribing'
                          || voice.status === 'pending'
                          || voice.status === 'replying'
                          || voice.status === 'interrupted'
                          || voice.status === 'error') ? (
                          <button
                            type="button"
                            className="avatar-companion__ghost"
                            onClick={() => {
                              abortVoiceInteraction();
                              setVoice((current) => closeVoiceCompanion(current));
                              if (!companion.latestAssistantMessage && !companion.latestUserCue) {
                                setCompanion((current) => collapseCompanionBubble(dismissCompanionInput(current)));
                              }
                            }}
                          >
                            {voice.status === 'transcribing' ? 'Cancel voice' : 'Close voice'}
                          </button>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  {companion.latestUserCue ? (
                    <p className="avatar-companion__echo">
                      You: {companion.latestUserCue.text}
                    </p>
                  ) : null}

                  {companion.sendError ? (
                    <p className="avatar-companion__error">{companion.sendError}</p>
                  ) : null}

                  {companion.inputVisible ? (
                    <form
                      className="avatar-companion__input"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!bootstrapHandle || !companionBinding) {
                          return;
                        }
                        const text = normalizeText(companion.draft);
                        if (!text) {
                          return;
                        }
                        const submittedAt = new Date().toISOString();
                        setCompanion((current) => beginCompanionSubmit(current, {
                          text,
                          at: submittedAt,
                        }));
                        void bootstrapHandle.requestTextTurn({
                          agentId: companionBinding.agentId,
                          conversationAnchorId: companionBinding.conversationAnchorId,
                          text,
                        }).then(() => {
                          setCompanion((current) => completeCompanionSubmit(current));
                        }).catch((error: unknown) => {
                          setCompanion((current) => failCompanionSubmit(current, {
                            message: toErrorMessage(error),
                            draft: text,
                          }));
                        });
                      }}
                    >
                      <label className="avatar-companion__field">
                        <span className="avatar-companion__field-label">Quick note</span>
                        <textarea
                          value={companion.draft}
                          onChange={(event) => {
                            setCompanion((current) => setCompanionDraft(current, event.target.value));
                          }}
                          rows={2}
                          maxLength={400}
                          placeholder="Send a lightweight note to this anchor"
                        />
                      </label>
                      <div className="avatar-companion__actions">
                        <button
                          type="button"
                          className="avatar-companion__ghost"
                          onClick={() => {
                            setCompanion((current) => dismissCompanionInput(current));
                          }}
                        >
                          Dismiss
                        </button>
                        <button
                          type="submit"
                          className="avatar-companion__send"
                          disabled={companion.sendState === 'sending' || !normalizeText(companion.draft)}
                        >
                          {companion.sendState === 'sending' ? 'Sending...' : 'Send'}
                        </button>
                      </div>
                    </form>
                  ) : !voice.panelVisible ? (
                    <div className="avatar-companion__footer">
                      <span className="avatar-companion__hint">
                        {companionBusy ? 'Current anchor is responding.' : 'Current anchor stays explicit to this avatar launch.'}
                      </span>
                      <div className="avatar-companion__actions">
                        <button
                          type="button"
                          className="avatar-companion__ghost"
                          onClick={() => {
                            setCompanion((current) => openCompanionInput(current));
                          }}
                        >
                          Reply
                        </button>
                        <button
                          type="button"
                          className="avatar-companion__ghost"
                          onClick={() => {
                            setCompanion((current) => ({
                              ...current,
                              bubbleVisible: true,
                              unread: false,
                            }));
                            setVoice((current) => openVoiceCompanion(current));
                          }}
                        >
                          Voice
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : null}
        </section>

        <section className="avatar-panel">
          <div className="avatar-panel__eyebrow">
            <span className={`avatar-badge avatar-badge--${displayPresentation.tone}`}>{displayPresentation.badge}</span>
            {!relaunchNotice ? (
              <span className="avatar-badge avatar-badge--neutral">
                {shell.alwaysOnTop ? 'Always on top' : 'Floating shell'}
              </span>
            ) : null}
          </div>

          <div className="avatar-panel__tools">
            <button
              type="button"
              className={`avatar-panel__tool${settingsOpen ? ' avatar-panel__tool--active' : ''}`}
              aria-expanded={settingsOpen}
              aria-controls="avatar-shell-settings"
              onClick={() => {
                setSettingsOpen((current) => !current);
              }}
            >
              {settingsOpen ? 'Hide settings' : 'Shell settings'}
            </button>
            {showRecoveryPanel ? (
              <button
                type="button"
                className="avatar-panel__tool"
                onClick={() => {
                  reloadAvatarShell();
                }}
              >
                Reload shell
              </button>
            ) : null}
          </div>

          <div className="avatar-panel__copy">
            <p className="avatar-panel__kicker">First-party avatar surface</p>
            <h1 className="avatar-panel__title">{displayPresentation.title}</h1>
            <p className="avatar-panel__summary">{displayPresentation.summary}</p>
            <p className="avatar-panel__recovery">{displayPresentation.recovery}</p>
          </div>

          {showRecoveryPanel ? (
            <section className="avatar-recovery" aria-label="Avatar recovery posture">
              <div className="avatar-recovery__header">
                <strong className="avatar-recovery__title">{recoveryTitle}</strong>
                <span className={`avatar-badge avatar-badge--${displayPresentation.tone}`}>
                  {relaunchNotice ? 'Rebinding' : presentation.badge}
                </span>
              </div>
              <p className="avatar-recovery__summary">{recoverySummary}</p>
              <p className="avatar-recovery__hint">{recoveryHint}</p>
              <div className="avatar-recovery__actions">
                <button
                  type="button"
                  className="avatar-companion__send"
                  onClick={() => {
                    reloadAvatarShell();
                  }}
                >
                  {relaunchNotice ? 'Reload now' : 'Reload shell'}
                </button>
                {settingsError ? (
                  <button
                    type="button"
                    className="avatar-companion__ghost"
                    onClick={() => {
                      setSettingsError(null);
                    }}
                  >
                    Dismiss note
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {settingsOpen ? (
            <section
              id="avatar-shell-settings"
              className="avatar-settings"
              aria-label="Avatar companion settings"
            >
              <div className="avatar-settings__header">
                <strong className="avatar-settings__title">Companion settings</strong>
                <p className="avatar-settings__summary">
                  Only avatar-owned shell behaviors live here. Launch, auth, and runtime truth stay upstream.
                </p>
              </div>

              <label className="avatar-settings__toggle">
                <span className="avatar-settings__copy">
                  <strong>Always on top</strong>
                  <span>Changes this shell&apos;s stacking behavior without altering launch or auth posture.</span>
                </span>
                <input
                  aria-label="Always on top"
                  type="checkbox"
                  checked={shellSettings.alwaysOnTop}
                  onChange={(event) => {
                    applyAlwaysOnTopSetting(event.target.checked);
                  }}
                />
              </label>

              <label className="avatar-settings__toggle">
                <span className="avatar-settings__copy">
                  <strong>Auto-open new replies</strong>
                  <span>Fresh anchor replies can open immediately or wait as an unread cue.</span>
                </span>
                <input
                  aria-label="Auto-open new replies"
                  type="checkbox"
                  checked={shellSettings.bubbleAutoOpen}
                  onChange={(event) => {
                    const next = {
                      ...shellSettings,
                      bubbleAutoOpen: event.target.checked,
                    };
                    persistShellSettings(next);
                  }}
                />
              </label>

              <label className="avatar-settings__toggle">
                <span className="avatar-settings__copy">
                  <strong>Auto-collapse quiet bubble</strong>
                  <span>Collapses an idle reply bubble after a short calm period while keeping the anchor explicit.</span>
                </span>
                <input
                  aria-label="Auto-collapse quiet bubble"
                  type="checkbox"
                  checked={shellSettings.bubbleAutoCollapse}
                  onChange={(event) => {
                    const next = {
                      ...shellSettings,
                      bubbleAutoCollapse: event.target.checked,
                    };
                    persistShellSettings(next);
                  }}
                />
              </label>

              <label className="avatar-settings__toggle">
                <span className="avatar-settings__copy">
                  <strong>Show voice captions</strong>
                  <span>Controls bounded foreground voice captions only. It does not enable history or background voice.</span>
                </span>
                <input
                  aria-label="Show voice captions"
                  type="checkbox"
                  checked={shellSettings.showVoiceCaptions}
                  onChange={(event) => {
                    const next = {
                      ...shellSettings,
                      showVoiceCaptions: event.target.checked,
                    };
                    persistShellSettings(next);
                  }}
                />
              </label>

              {shellSettings.showVoiceCaptions === defaultAvatarShellSettings.showVoiceCaptions ? null : (
                <p className="avatar-settings__footnote">
                  Voice captions remain bounded to the current explicit anchor even when hidden.
                </p>
              )}
            </section>
          ) : null}

          {displayPresentation.meta.length > 0 ? (
            <dl className="avatar-meta" aria-label="Avatar surface status">
              {displayPresentation.meta.map((item) => (
                <div key={item.label} className="avatar-meta__item">
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {displayPresentation.contextCards.length > 0 ? (
            <div className="avatar-presence">
              {displayPresentation.contextCards.map((item) => (
                <div key={item.label}>
                  <span className="avatar-presence__label">{item.label}</span>
                  <strong className="avatar-presence__value">{item.value}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

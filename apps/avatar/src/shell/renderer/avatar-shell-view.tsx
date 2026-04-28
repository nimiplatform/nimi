import { useEffect, useMemo, useRef } from 'react';
import { isTauriRuntime } from './app-shell/tauri-lifecycle.js';
import { constrainWindowToVisibleArea, setIgnoreCursorEvents, startWindowDrag } from './app-shell/tauri-commands.js';
import { defaultAvatarShellSettings } from './settings-state.js';
import { reloadAvatarShell } from './shell-reload.js';
import {
  beginCompanionSubmit,
  completeCompanionSubmit,
  dismissCompanionInput,
  failCompanionSubmit,
  setCompanionDraft,
  type CompanionState,
} from './companion-state.js';
import {
  beginVoiceListening,
  beginVoiceTranscribing,
  setVoiceCompanionError,
  setVoiceLevel,
  setVoiceTranscriptSubmitted,
  type VoiceCompanionState,
} from './voice-companion-state.js';
import { Live2DCarrierVisualSurface } from './live2d/Live2DCarrierVisualSurface.js';
import { createAvatarHitRegionSnapshot, rectFromElement } from './interaction/avatar-hit-region.js';
import { AvatarInteractionController } from './interaction/avatar-interaction-controller.js';

type AvatarShellViewProps = Record<string, any>;
function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim();
}
function shortenId(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  if (!normalized) return 'Unavailable';
  return normalized.length > 16 ? `${normalized.slice(0, 8)}…${normalized.slice(-4)}` : normalized;
}
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function createAbortError(): Error {
  const error = new Error('Foreground voice request aborted.');
  error.name = 'AbortError';
  return error;
}
function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, input, textarea, select, a, form'));
}
export function AvatarShellView(props: AvatarShellViewProps) {
  const {
    activeTurnCue,
    applyAlwaysOnTopSetting,
    beginVoiceOperation,
    bootstrapHandle,
    canInterruptVoiceReply,
    canSwitchToTextMode,
    canSwitchToVoiceMode,
    clearVoiceOperation,
    closeCompanionSurface,
    closeVoiceMode,
    companion,
    companionAvailable,
    companionBinding,
    companionBody,
    companionBusy,
    companionClassName,
    companionStatusLabel,
    companionStatusTone,
    companionTitle,
    companionVisible,
    displayPresentation,
    embodiedSurfaceReady,
    focusVisibleWithinStage,
    interactionModality,
    openTextMode,
    openVoiceMode,
    persistShellSettings,
    presentation,
    recoveryChecklist,
    recoveryGuidance,
    recoveryHint,
    recoverySummary,
    recoveryTitle,
    relaunchNotice,
    settingsError,
    settingsOpen,
    setBodyHovered,
    setBodyPointerContact,
    setCompanion,
    setFocusVisibleWithinStage,
    setSettingsError,
    setSettingsOpen,
    setVoice,
    shell,
    shellClassName,
    shellControlEffects,
    shellControlHint,
    shellControlSummary,
    showShellControlsPanel,
    shellSettings,
    showRecoveryPanel,
    showSurfaceStatusCopy,
    stageClassName,
    stageInteractionRef,
    textModeActive,
    triggerRowClassName,
    voice,
    voiceCaptureSessionRef,
    voiceModeActive,
    voicePrimaryActionDisabled,
    voicePrimaryActionLabel,
    voiceSubmitAbortRef,
    voiceUnavailable,
    isVoiceOperationCurrent,
    companionAnchorKey
  } = props;
  const avatarBodyRef = useRef<HTMLDivElement | null>(null);
  const controller = useMemo(() => new AvatarInteractionController({
    getHitRegionSnapshot: () => {
      if (!embodiedSurfaceReady) return null;
      const body = rectFromElement(avatarBodyRef.current, 'body') ?? {
        x: 0,
        y: 0,
        width: Math.max(1, shell.windowSize?.width ?? 400),
        height: Math.max(1, shell.windowSize?.height ?? 600),
        region: 'body' as const,
      };
      return createAvatarHitRegionSnapshot({
        body,
        capturedAtMs: performance.now(),
      });
    },
    emit: (event) => {
      bootstrapHandle?.driver?.emit(event);
    },
    setPointerInside: (inside) => {
      setBodyHovered(inside);
    },
    setPointerContact: (contact) => {
      setBodyPointerContact(contact);
    },
    setClickThrough: (ignore) => setIgnoreCursorEvents(ignore),
    startWindowDrag,
    constrainWindowToVisibleArea,
    nowMs: () => performance.now(),
    isTauriRuntime,
  }), [
    bootstrapHandle,
    embodiedSurfaceReady,
    setBodyHovered,
    setBodyPointerContact,
    shell.windowSize?.height,
    shell.windowSize?.width,
  ]);
  useEffect(() => () => {
    controller.teardown();
  }, [controller]);
return (
    <div className="avatar-root">
      <div
        className={shellClassName}
        data-testid="avatar-shell"
        onPointerMove={(event) => {
          if (isInteractiveTarget(event.target)) return;
          controller.pointerMove(event);
        }}
        onPointerLeave={(event) => {
          controller.pointerLeave(event);
        }}
        role="presentation"
      >
        <div className="avatar-shell__halo avatar-shell__halo--outer" />
        <div className="avatar-shell__halo avatar-shell__halo--inner" />
        <div className="avatar-shell__frame">
          <header className="avatar-shell__header">
            <div className="avatar-panel__eyebrow">
              <span className={`avatar-badge avatar-badge--${displayPresentation.tone}`}>{displayPresentation.badge}</span>
              {!relaunchNotice ? (
                <span className="avatar-badge avatar-badge--neutral">
                  {shell.alwaysOnTop ? 'Always on top' : 'Floating shell'}
                </span>
              ) : null}
            </div>
            <div className="avatar-panel__tools avatar-panel__tools--secondary">
              <button
                type="button"
                className={`avatar-panel__tool${settingsOpen ? ' avatar-panel__tool--active' : ''}`}
                aria-expanded={settingsOpen}
                aria-controls="avatar-shell-settings"
                onClick={() => {
                  setSettingsOpen((current: boolean) => !current);
                }}
              >
                {settingsOpen ? 'Hide settings' : 'Shell settings'}
              </button>
            </div>
          </header>
          <section className="avatar-hero">
            <section
              ref={stageInteractionRef}
              className={stageClassName}
              data-testid="avatar-stage"
              onPointerEnter={(event) => {
                if (isInteractiveTarget(event.target)) return;
                controller.pointerMove(event);
              }}
              onPointerLeave={() => {
                controller.pointerCancel();
              }}
              onPointerDown={(event) => {
                if (isInteractiveTarget(event.target)) return;
                controller.pointerDown(event);
              }}
              onPointerUp={(event) => {
                if (isInteractiveTarget(event.target)) return;
                controller.pointerUp(event);
              }}
              onPointerCancel={() => {
                controller.pointerCancel();
              }}
              onFocusCapture={() => {
                if (!embodiedSurfaceReady) {
                  return;
                }
                setFocusVisibleWithinStage(interactionModality === 'keyboard');
              }}
              onBlurCapture={(event) => {
                const currentTarget = event.currentTarget;
                window.requestAnimationFrame(() => {
                  const activeElement = document.activeElement;
                  if (!embodiedSurfaceReady) {
                    setFocusVisibleWithinStage(false);
                    return;
                  }
                  if (
                    interactionModality === 'keyboard'
                    && activeElement instanceof Element
                    && currentTarget.contains(activeElement)
                  ) {
                    setFocusVisibleWithinStage(true);
                    return;
                  }
                  setFocusVisibleWithinStage(false);
                });
              }}
            >
              <Live2DCarrierVisualSurface session={bootstrapHandle?.carrier?.backendSession ?? null} />
              <div className="avatar-stage__backdrop" />
              <div className="avatar-stage__orbit avatar-stage__orbit--one" />
              <div className="avatar-stage__orbit avatar-stage__orbit--two" />
              <div className="avatar-stage__body" data-testid="avatar-body-hit-region" ref={avatarBodyRef}>
                <div className="avatar-stage__glow" />
                <div className="avatar-stage__core">
                  <span className="avatar-stage__label">{displayPresentation.stageLabel}</span>
                  <strong className="avatar-stage__value">{displayPresentation.stageValue}</strong>
                </div>
              </div>
              {companionAvailable ? (
                <>
                  <div className={triggerRowClassName} data-testid="avatar-trigger-row">
                    <button
                      type="button"
                      className={`avatar-companion-trigger${companion.unread ? ' avatar-companion-trigger--unread' : ''}${companionVisible && !voiceModeActive ? ' avatar-companion-trigger--active' : ''}`}
                      onClick={openTextMode}
                      aria-label="Open avatar companion input"
                    >
                      <span className="avatar-companion-trigger__icon">+</span>
                      <span className="avatar-companion-trigger__copy">
                        <span className="avatar-companion-trigger__label">Companion</span>
                        <span className="avatar-companion-trigger__meta">
                          {companion.unread ? 'Unread reply on this anchor' : 'Text or review this anchor'}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`avatar-companion-trigger avatar-companion-trigger--voice${voice.panelVisible ? ' avatar-companion-trigger--active' : ''}`}
                      onClick={openVoiceMode}
                      aria-label="Open avatar voice companion"
                    >
                      <span className="avatar-companion-trigger__icon">o</span>
                      <span className="avatar-companion-trigger__copy">
                        <span className="avatar-companion-trigger__label">Voice turn</span>
                        <span className="avatar-companion-trigger__meta">
                          {voiceUnavailable ? 'Unavailable on this anchor' : 'Foreground only, same anchor'}
                        </span>
                      </span>
                    </button>
                  </div>
                  {companionVisible ? (
                    <section
                      className={companionClassName}
                      data-testid="avatar-companion-bubble"
                      aria-label="Avatar companion bubble"
                    >
                      <header className="avatar-companion__header">
                        <div className="avatar-companion__identity">
                          <p className="avatar-companion__eyebrow">Anchor companion</p>
                          <strong className="avatar-companion__title">{companionTitle}</strong>
                          <strong className="avatar-companion__anchor">
                            {shortenId(companionBinding?.agentId)} / {shortenId(companionBinding?.conversationAnchorId)}
                          </strong>
                        </div>
                        <div className="avatar-companion__header-actions">
                          <span className={`avatar-companion__state avatar-companion__state--${companionStatusTone}`}>
                            {companionStatusLabel}
                          </span>
                          <button
                            type="button"
                            className="avatar-companion__close"
                            onClick={closeCompanionSurface}
                            aria-label="Collapse companion bubble"
                          >
                            x
                          </button>
                        </div>
                      </header>
                      <div className="avatar-companion__mode-rail" role="toolbar" aria-label="Companion mode">
                        <button
                          type="button"
                          className={`avatar-companion__mode${textModeActive ? ' avatar-companion__mode--active' : ''}`}
                          onClick={openTextMode}
                          disabled={!canSwitchToTextMode && !textModeActive}
                          aria-pressed={textModeActive}
                        >
                          Text note
                        </button>
                        <button
                          type="button"
                          className={`avatar-companion__mode${voiceModeActive ? ' avatar-companion__mode--active' : ''}`}
                          onClick={openVoiceMode}
                          disabled={!canSwitchToVoiceMode && !voiceModeActive}
                          aria-pressed={voiceModeActive}
                        >
                          Foreground voice
                        </button>
                      </div>
                      <p className="avatar-companion__message">{companionBody}</p>
                      {voiceModeActive ? (
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
                                    setVoice((current: VoiceCompanionState) => setVoiceCompanionError(current, 'Foreground voice capture is no longer active.'));
                                    return;
                                  }
                                  const operationAnchorKey = companionAnchorKey;
                                  const operationId = beginVoiceOperation(operationAnchorKey);
                                  voiceCaptureSessionRef.current = null;
                                  setVoice((current: VoiceCompanionState) => beginVoiceTranscribing(current));
                                  const abortController = new AbortController();
                                  voiceSubmitAbortRef.current = abortController;
                                  void activeSession.stop().then((recording: { bytes: Uint8Array; mimeType: string }) => {
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
                                  }).then((result: { transcript: string }) => {
                                    if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) {
                                      return;
                                    }
                                    setVoice((current: VoiceCompanionState) => setVoiceTranscriptSubmitted(current, {
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
                                    setVoice((current: VoiceCompanionState) => setVoiceCompanionError(current, toErrorMessage(error)));
                                  }).finally(() => {
                                    if (voiceSubmitAbortRef.current === abortController) {
                                      voiceSubmitAbortRef.current = null;
                                    }
                                    clearVoiceOperation(operationId, operationAnchorKey);
                                  });
                                  return;
                                }
                                setCompanion((current: CompanionState) => ({
                                  ...current,
                                  bubbleVisible: true,
                                  unread: false,
                                }));
                                setVoice((current: VoiceCompanionState) => beginVoiceListening(current));
                                const operationAnchorKey = companionAnchorKey;
                                const operationId = beginVoiceOperation(operationAnchorKey);
                                void bootstrapHandle.startVoiceCapture({
                                  agentId: companionBinding.agentId,
                                  conversationAnchorId: companionBinding.conversationAnchorId,
                                  onLevelChange: (amplitude: number) => {
                                    if (!isVoiceOperationCurrent(operationId, operationAnchorKey)) {
                                      return;
                                    }
                                    setVoice((current: VoiceCompanionState) => setVoiceLevel(current, amplitude));
                                  },
                                }).then((session: { cancel(): void }) => {
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
                                  setVoice((current: VoiceCompanionState) => setVoiceCompanionError(current, toErrorMessage(error)));
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
                                    setVoice((current: VoiceCompanionState) => setVoiceCompanionError(current, toErrorMessage(error)));
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
                                onClick={closeVoiceMode}
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
                      {textModeActive && companion.latestAssistantMessage ? (
                        <p className="avatar-companion__echo">
                          {companion.latestAssistantMessage.text}
                        </p>
                      ) : null}
                      {companion.sendError ? (
                        <p className="avatar-companion__error">{companion.sendError}</p>
                      ) : null}
                      {textModeActive ? (
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
                            setCompanion((current: CompanionState) => beginCompanionSubmit(current, {
                              text,
                              at: submittedAt,
                            }));
                            void bootstrapHandle.requestTextTurn({
                              agentId: companionBinding.agentId,
                              conversationAnchorId: companionBinding.conversationAnchorId,
                              text,
                            }).then(() => {
                              setCompanion((current: CompanionState) => completeCompanionSubmit(current));
                            }).catch((error: unknown) => {
                              setCompanion((current: CompanionState) => failCompanionSubmit(current, {
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
                                setCompanion((current: CompanionState) => setCompanionDraft(current, event.target.value));
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
                                setCompanion((current: CompanionState) => dismissCompanionInput(current));
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
                            {companionBusy
                              ? 'Current anchor is responding. Keep this companion open until authoritative reply evidence arrives.'
                              : 'This companion stays bounded to the current explicit anchor for both text note and foreground voice.'}
                          </span>
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </>
              ) : null}
            </section>
            {showSurfaceStatusCopy ? (
            <div className="avatar-panel__copy">
              <p className="avatar-panel__kicker">First-party avatar surface</p>
              <h1 className="avatar-panel__title">{displayPresentation.title}</h1>
              <p className="avatar-panel__summary">{displayPresentation.summary}</p>
              <p className="avatar-panel__recovery">{displayPresentation.recovery}</p>
            </div>
            ) : null}
          </section>
          <section className="avatar-panel">
            {showRecoveryPanel ? (
              <section className="avatar-recovery" aria-label="Avatar recovery posture">
                <div className="avatar-recovery__header">
                  <strong className="avatar-recovery__title">{recoveryTitle}</strong>
                  <div className="avatar-recovery__badges">
                    <span className={`avatar-badge avatar-badge--${displayPresentation.tone}`}>
                      {relaunchNotice ? 'Rebinding' : presentation.badge}
                    </span>
                    <span className="avatar-badge avatar-badge--neutral">Reload-only</span>
                  </div>
                </div>
                <p className="avatar-recovery__summary">{recoverySummary}</p>
                <p className="avatar-recovery__guidance">{recoveryGuidance}</p>
                <p className="avatar-recovery__hint">{recoveryHint}</p>
                <div className="avatar-recovery__checklist" aria-label="Recovery scope">
                  {recoveryChecklist.map((item: string) => (
                    <p key={item} className="avatar-recovery__check">
                      {item}
                    </p>
                  ))}
                </div>
                <div className="avatar-recovery__actions">
                  <button
                    type="button"
                    className="avatar-companion__send"
                    onClick={() => {
                      reloadAvatarShell();
                    }}
                  >
                    Reload shell now
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
            {showShellControlsPanel ? (
            <section className="avatar-settings-card" aria-label="Avatar shell controls">
              <div className="avatar-settings-card__header">
                <div className="avatar-settings-card__copy">
                  <strong className="avatar-settings-card__title">Shell controls</strong>
                  <p className="avatar-settings-card__summary">{shellControlSummary}</p>
                </div>
                <span className="avatar-badge avatar-badge--neutral">4 local settings</span>
              </div>
              <div className="avatar-settings-card__effects">
                {shellControlEffects.map((item: { label: string; value: string; detail: string }) => (
                  <div key={item.label} className="avatar-settings-card__effect">
                    <div className="avatar-settings-card__effect-copy">
                      <span className="avatar-settings-card__effect-label">{item.label}</span>
                      <strong className="avatar-settings-card__effect-value">{item.value}</strong>
                    </div>
                    <p className="avatar-settings-card__effect-detail">{item.detail}</p>
                  </div>
                ))}
              </div>
              <p className="avatar-settings-card__hint">{shellControlHint}</p>
            </section>
            ) : null}
            {displayPresentation.contextCards.length > 0 ? (
              <div className="avatar-presence">
                {displayPresentation.contextCards.map((item: { label: string; value: string }) => (
                  <div key={item.label}>
                    <span className="avatar-presence__label">{item.label}</span>
                    <strong className="avatar-presence__value">{item.value}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            {displayPresentation.meta.length > 0 ? (
              <dl className="avatar-meta" aria-label="Avatar surface status">
                {displayPresentation.meta.map((item: { label: string; value: string }) => (
                  <div key={item.label} className="avatar-meta__item">
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
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
                    These are the admitted avatar-shell-local controls from existing app authority. Launch and runtime truth stay upstream.
                  </p>
                </div>
                <div className="avatar-settings__group">
                  <div className="avatar-settings__group-copy">
                    <strong className="avatar-settings__group-title">Window behavior</strong>
                    <p className="avatar-settings__group-summary">
                      Adjust only how this avatar shell sits in the desktop stack. Focus and trusted launch posture stay separate.
                    </p>
                  </div>
                  <label className="avatar-settings__toggle">
                    <span className="avatar-settings__copy">
                      <strong>Always on top</strong>
                      <span>Keeps this shell above other windows. It does not alter launch, runtime, or focus truth.</span>
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
                </div>
                <div className="avatar-settings__group">
                  <div className="avatar-settings__group-copy">
                    <strong className="avatar-settings__group-title">Companion bubble</strong>
                    <p className="avatar-settings__group-summary">
                      Decide how fresh replies reveal and how a quiet bubble settles, while the current explicit anchor stays the same.
                    </p>
                  </div>
                  <label className="avatar-settings__toggle">
                    <span className="avatar-settings__copy">
                      <strong>Auto-open new replies</strong>
                      <span>When on, fresh replies open immediately. When off, they wait as an unread cue until you open the companion.</span>
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
                      <span>When on, an idle bubble settles after a short calm period. When off, it stays open until you close it.</span>
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
                </div>
                <div className="avatar-settings__group">
                  <div className="avatar-settings__group-copy">
                    <strong className="avatar-settings__group-title">Foreground voice</strong>
                    <p className="avatar-settings__group-summary">
                      Voice remains foreground-only and same-anchor. This group only controls caption reveal inside that bounded path.
                    </p>
                  </div>
                  <label className="avatar-settings__toggle">
                    <span className="avatar-settings__copy">
                      <strong>Show voice captions</strong>
                      <span>Controls bounded foreground voice captions only. It does not enable history, background voice, or detached transcript views.</span>
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
                </div>
                {shellSettings.showVoiceCaptions === defaultAvatarShellSettings.showVoiceCaptions ? null : (
                  <p className="avatar-settings__footnote">
                    Voice captions remain bounded to the current explicit anchor even when hidden.
                  </p>
                )}
              </section>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

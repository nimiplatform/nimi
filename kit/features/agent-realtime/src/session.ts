import {
  asNimiError,
  createNimiError,
  type NimiAgentRealtimeEvent,
  type NimiError,
  type NimiRealtimeOperationResult,
  type NimiRealtimeSubscription,
} from '@nimiplatform/kit/core/sdk-contract';

import {
  createNimiAgentRealtimeSessionState,
  reduceNimiAgentRealtimeSessionState,
} from './reducer.js';
import type {
  CreateNimiAgentRealtimeSessionInput,
  NimiAgentRealtimeCaptureHandle,
  NimiAgentRealtimeCaptureRequestResult,
  NimiAgentRealtimeClient,
  NimiAgentRealtimeHostMediaPort,
  NimiAgentRealtimeOpenResult,
  NimiAgentRealtimeSession,
  NimiAgentRealtimeSessionAction,
  NimiAgentRealtimeSessionState,
} from './types.js';

type ActiveSessionScope = {
  readonly epoch: number;
  readonly agentHandle: CreateNimiAgentRealtimeSessionInput['agentHandle'];
  readonly realtimeSessionId: string;
  readonly generation: string;
};

type ActiveCapture = {
  readonly epoch: number;
  readonly handle: NimiAgentRealtimeCaptureHandle;
};

// @nimi-authority: rule.nimi.sdks.feature-clients.r108
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-017
export function createNimiAgentRealtimeSession(
  input: CreateNimiAgentRealtimeSessionInput,
): NimiAgentRealtimeSession {
  const stateListeners = new Set<(state: NimiAgentRealtimeSessionState) => void>();
  const eventListeners = new Set<(event: NimiAgentRealtimeEvent) => void>();
  let state = createNimiAgentRealtimeSessionState(input);
  let activeSession: ActiveSessionScope | null = null;
  let activeCapture: ActiveCapture | null = null;
  let activeSubscription: NimiRealtimeSubscription<NimiAgentRealtimeEvent> | null = null;
  let frameInFlight = false;
  const playbackInterruptedTracks = new Set<string>();

  const dispatch = (action: NimiAgentRealtimeSessionAction): void => {
    const next = reduceNimiAgentRealtimeSessionState(state, action);
    if (next === state) return;
    state = next;
    for (const listener of stateListeners) notifyListener(listener, state);
  };

  const controller: NimiAgentRealtimeSession = {
    getState: () => state,
    subscribeState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    async open() {
      if (state.lifecycle === 'opening' || state.lifecycle === 'closing' || activeSession) {
        throw recordIssue(sessionError(
          'KIT_AGENT_REALTIME_SESSION_ACTIVE',
          'An Agent Realtime session is already opening or active.',
          'close_current_agent_realtime_session',
          false,
        ), false);
      }

      const epoch = state.sessionEpoch + 1;
      dispatch({ type: 'open-requested', epoch });
      let result: NimiAgentRealtimeOpenResult;
      try {
        result = await input.agentRealtime.open({
          agentHandle: input.agentHandle,
          ...(input.conversationAnchorId === undefined
            ? {}
            : { conversationAnchorId: input.conversationAnchorId }),
          inputAudio: input.inputAudio,
          turnDetection: input.turnDetection,
        });
      } catch (cause) {
        const error = runtimeError(cause, 'open Agent Realtime', 'retry_agent_realtime_open');
        if (state.sessionEpoch === epoch) recordIssue(error, true);
        throw error;
      }

      const scope: ActiveSessionScope = Object.freeze({
        epoch,
        agentHandle: input.agentHandle,
        realtimeSessionId: result.realtimeSessionId,
        generation: result.generation,
      });
      const stateAfterOpen = controller.getState();
      if (stateAfterOpen.sessionEpoch !== epoch || stateAfterOpen.lifecycle !== 'opening') {
        await closeStaleOpen(input.agentRealtime, scope);
        throw staleEpochError();
      }
      if (result.control.lifecycle === 'closed' || result.control.lifecycle === 'failed') {
        const error = terminalControlError(result);
        dispatch({ type: 'open-succeeded', epoch, result });
        recordIssue(error, true);
        throw error;
      }

      activeSession = scope;
      dispatch({ type: 'open-succeeded', epoch, result });
      let subscription: NimiRealtimeSubscription<NimiAgentRealtimeEvent>;
      try {
        subscription = await input.agentRealtime.subscribe(scopeInput(scope));
      } catch (cause) {
        activeSession = null;
        await closeAfterSubscribeFailure(input.agentRealtime, scope);
        const error = runtimeError(
          cause,
          'subscribe to Agent Realtime',
          'retry_agent_realtime_open',
        );
        if (state.sessionEpoch === epoch) recordIssue(error, true);
        throw error;
      }
      if (state.sessionEpoch !== epoch || activeSession !== scope) {
        await subscription.cancel();
        await closeStaleOpen(input.agentRealtime, scope);
        throw staleEpochError();
      }
      activeSubscription = subscription;
      void pumpSubscription(subscription, scope);
      return result;
    },
    async sendText(textInput) {
      const scope = requireActiveSession('send Agent Realtime text');
      requireWritablePressure(scope.epoch);
      try {
        const result = await input.agentRealtime.appendInput({
          ...scopeInput(scope),
          input: {
            type: 'text',
            requestId: textInput.requestId,
            text: textInput.text,
          },
        });
        applyOperationResult(scope.epoch, result);
        await enforceBlockedPressure(scope);
        return result;
      } catch (cause) {
        const error = runtimeError(cause, 'send Agent Realtime text', 'retry_agent_realtime_input');
        if (isCurrent(scope)) recordIssue(error, true);
        throw error;
      }
    },
    async requestCapture(): Promise<NimiAgentRealtimeCaptureRequestResult> {
      const scope = requireActiveSession('start Agent Realtime microphone capture');
      if (state.lifecycle !== 'ready') {
        throw recordIssue(sessionError(
          'KIT_AGENT_REALTIME_CAPTURE_NOT_READY',
          'Microphone capture requires a ready Agent Realtime session.',
          'wait_for_agent_realtime_ready',
          true,
        ), false);
      }
      requireWritablePressure(scope.epoch);
      if (activeCapture) {
        throw recordIssue(sessionError(
          'KIT_AGENT_REALTIME_CAPTURE_ACTIVE',
          'Microphone capture is already active.',
          'stop_current_microphone_capture',
          false,
        ), false);
      }
      const format = state.negotiatedInputAudio;
      if (!format) {
        throw recordIssue(sessionError(
          'KIT_AGENT_REALTIME_INPUT_FORMAT_UNAVAILABLE',
          'The Agent Realtime session did not provide a negotiated input audio format.',
          'reopen_agent_realtime_session',
          true,
        ), true);
      }

      dispatch({ type: 'capture-requested', epoch: scope.epoch });
      let started;
      try {
        started = await input.host.microphone.beginCapture({
          format,
          onFrame: (frame) => appendCapturedFrame(scope, frame),
          onCaptureEnded: (reason) => handleCaptureEnded(scope, reason),
        });
      } catch (cause) {
        const error = hostError(
          cause,
          'KIT_AGENT_REALTIME_MICROPHONE_UNAVAILABLE',
          'The Host could not start microphone capture.',
          'check_microphone_device_and_retry',
          true,
        );
        if (isCurrent(scope)) {
          dispatch({
            type: 'capture-unavailable',
            epoch: scope.epoch,
            state: 'device-unavailable',
            error,
          });
        }
        throw error;
      }

      if (started.status === 'permission-denied') {
        const error = sessionError(
          'KIT_AGENT_REALTIME_MICROPHONE_PERMISSION_DENIED',
          'The operating system did not grant microphone access.',
          'grant_microphone_permission_and_retry',
          true,
        );
        if (isCurrent(scope)) {
          dispatch({
            type: 'capture-unavailable',
            epoch: scope.epoch,
            state: 'permission-denied',
            error,
          });
        }
        return Object.freeze({ status: 'permission-denied', error });
      }
      if (started.status === 'device-unavailable') {
        const error = sessionError(
          'KIT_AGENT_REALTIME_MICROPHONE_DEVICE_UNAVAILABLE',
          'No usable microphone device is available.',
          'select_available_microphone_and_retry',
          true,
        );
        if (isCurrent(scope)) {
          dispatch({
            type: 'capture-unavailable',
            epoch: scope.epoch,
            state: 'device-unavailable',
            error,
          });
        }
        return Object.freeze({ status: 'device-unavailable', error });
      }
      assertCaptureHandle(started.capture);
      if (!isCurrent(scope) || state.capture !== 'requesting') {
        await started.capture.stop();
        throw staleEpochError();
      }
      activeCapture = Object.freeze({ epoch: scope.epoch, handle: started.capture });
      dispatch({ type: 'capture-started', epoch: scope.epoch });
      return Object.freeze({ status: 'started' });
    },
    async stopCapture() {
      const scope = requireActiveSession('stop Agent Realtime microphone capture');
      if (!activeCapture || activeCapture.epoch !== scope.epoch) {
        throw recordIssue(sessionError(
          'KIT_AGENT_REALTIME_CAPTURE_NOT_ACTIVE',
          'No microphone capture is active.',
          'start_microphone_capture',
          false,
        ), false);
      }
      return stopCapture(scope, 'stopped');
    },
    async interruptOutput(interruptInput) {
      const scope = requireActiveSession('interrupt Agent Realtime output');
      let result: NimiRealtimeOperationResult;
      try {
        result = await input.agentRealtime.interruptOutput({
          ...scopeInput(scope),
          outputTrackId: interruptInput.outputTrackId,
          interruptAgentTurn: interruptInput.interruptAgentTurn,
        });
        applyOperationResult(scope.epoch, result);
      } catch (cause) {
        const error = runtimeError(
          cause,
          'interrupt Agent Realtime output',
          'retry_agent_realtime_interrupt',
        );
        if (isCurrent(scope)) recordIssue(error, false);
        throw error;
      }
      try {
        await input.host.playback.interruptOutputTrack({
          outputTrackId: interruptInput.outputTrackId,
        });
      } catch (cause) {
        const error = playbackError(cause);
        if (isCurrent(scope)) {
          dispatch({ type: 'playback-failed', epoch: scope.epoch, error });
        }
        throw error;
      }
      return result;
    },
    async close() {
      const closingSession = activeSession;
      const closingSubscription = activeSubscription;
      const closeEpoch = state.sessionEpoch + 1;
      dispatch({ type: 'close-requested', epoch: closeEpoch });
      activeSession = null;
      activeSubscription = null;
      let firstError: NimiError | null = null;
      let result: NimiRealtimeOperationResult | null = null;

      if (closingSession && activeCapture?.epoch === closingSession.epoch) {
        try {
          await stopCaptureForClosing(closingSession);
        } catch (cause) {
          firstError = hostOrRuntimeCloseError(cause);
        }
      } else if (activeCapture) {
        const capture = activeCapture;
        activeCapture = null;
        try {
          await capture.handle.stop();
        } catch (cause) {
          firstError = hostOrRuntimeCloseError(cause);
        }
      }

      if (closingSubscription) {
        try {
          await closingSubscription.cancel();
        } catch (cause) {
          firstError ??= runtimeError(
            cause,
            'cancel Agent Realtime subscription',
            'retry_agent_realtime_close',
          );
        }
      }
      if (closingSession) {
        try {
          result = await input.agentRealtime.close(scopeInput(closingSession));
        } catch (cause) {
          firstError ??= runtimeError(
            cause,
            'close Agent Realtime',
            'retry_agent_realtime_close',
          );
        }
      }
      try {
        await input.host.playback.close();
      } catch (cause) {
        firstError ??= playbackError(cause);
      }

      if (firstError) {
        dispatch({
          type: 'operation-failed',
          epoch: closeEpoch,
          error: firstError,
          terminal: true,
        });
        throw firstError;
      }
      dispatch({ type: 'closed', epoch: closeEpoch });
      return result;
    },
  };

  async function pumpSubscription(
    subscription: NimiRealtimeSubscription<NimiAgentRealtimeEvent>,
    scope: ActiveSessionScope,
  ): Promise<void> {
    try {
      for await (const envelope of subscription) {
        if (!isCurrent(scope) || activeSubscription !== subscription) return;
        dispatch({
          type: 'control-observed',
          epoch: scope.epoch,
          control: envelope.control,
        });
        dispatch({ type: 'event-observed', epoch: scope.epoch, event: envelope.event });
        for (const listener of eventListeners) notifyListener(listener, envelope.event);
        await projectHostPlayback(scope, envelope.event);
        await enforceBlockedPressure(scope);
        if (envelope.event.type === 'terminal') {
          if (envelope.control.lifecycle !== 'closed') {
            recordIssue(createNimiError({
              message: envelope.event.reasonCode || 'Agent Realtime session failed.',
              code: envelope.event.reasonCode || 'KIT_AGENT_REALTIME_TERMINAL',
              reasonCode: envelope.event.reasonCode || 'KIT_AGENT_REALTIME_TERMINAL',
              actionHint: envelope.control.actionHint || 'reopen_agent_realtime_session',
              retryable: true,
              source: 'runtime',
            }), true, scope.epoch);
          }
          await releaseTerminalMedia(scope);
          activeSession = null;
          activeSubscription = null;
          return;
        }
      }
      if (isCurrent(scope) && activeSubscription === subscription
        && state.lifecycle !== 'closed' && state.lifecycle !== 'failed') {
        recordIssue(sessionError(
          'KIT_AGENT_REALTIME_EVENT_STREAM_ENDED',
          'The Agent Realtime event stream ended without a terminal event.',
          'reopen_agent_realtime_session',
          true,
        ), true);
        await releaseTerminalMedia(scope);
        activeSession = null;
        activeSubscription = null;
      }
    } catch (cause) {
      if (!isCurrent(scope) || activeSubscription !== subscription) return;
      const error = runtimeError(
        cause,
        'read Agent Realtime events',
        'reopen_agent_realtime_session',
      );
      recordIssue(error, true);
      await releaseTerminalMedia(scope);
      activeSession = null;
      activeSubscription = null;
    }
  }

  async function appendCapturedFrame(
    scope: ActiveSessionScope,
    frame: { readonly frameSequence: string; readonly frame: Uint8Array },
  ): Promise<void> {
    if (!isCurrent(scope) || activeCapture?.epoch !== scope.epoch
      || state.capture !== 'active') return;
    if (frameInFlight) {
      const error = sessionError(
        'KIT_AGENT_REALTIME_CAPTURE_OVERRUN',
        'The Host delivered another microphone frame before the previous frame settled.',
        'restart_microphone_capture',
        true,
      );
      recordIssue(error, false);
      await stopCapture(scope, 'stopped');
      throw error;
    }
    if (state.pressure === 'blocked') {
      await stopCapture(scope, 'stopped');
      return;
    }
    const capture = activeCapture;
    frameInFlight = true;
    try {
      const result = await input.agentRealtime.appendInput({
        ...scopeInput(scope),
        input: {
          type: 'audio-frame',
          inputTrackId: capture.handle.inputTrackId,
          utteranceId: capture.handle.utteranceId,
          frameSequence: frame.frameSequence,
          frame: frame.frame,
        },
      });
      applyOperationResult(scope.epoch, result);
      if (!result.ack.ok) await stopCapture(scope, 'stopped');
      else await enforceBlockedPressure(scope);
    } catch (cause) {
      const error = runtimeError(
        cause,
        'append Agent Realtime audio',
        'reopen_agent_realtime_session',
      );
      if (isCurrent(scope)) recordIssue(error, true);
      await releaseCaptureWithoutObservation(scope, 'stopped');
      throw error;
    } finally {
      frameInFlight = false;
    }
  }

  async function handleCaptureEnded(
    scope: ActiveSessionScope,
    reason: 'device-lost' | 'capture-overrun',
  ): Promise<void> {
    if (!isCurrent(scope) || activeCapture?.epoch !== scope.epoch) return;
    try {
      await stopCapture(scope, reason === 'device-lost' ? 'device-lost' : 'stopped');
    } catch {
      // stopCapture already records the exact Runtime or Host failure.
    }
    if (!isCurrent(scope)) return;
    recordIssue(reason === 'device-lost'
      ? sessionError(
        'KIT_AGENT_REALTIME_MICROPHONE_DEVICE_LOST',
        'The active microphone device was lost.',
        'select_available_microphone_and_retry',
        true,
      )
      : sessionError(
        'KIT_AGENT_REALTIME_CAPTURE_OVERRUN',
        'The Host microphone frame queue exceeded its bounded capacity.',
        'restart_microphone_capture',
        true,
      ), false);
  }

  async function stopCapture(
    scope: ActiveSessionScope,
    captureState: 'stopped' | 'device-lost',
  ): Promise<NimiRealtimeOperationResult> {
    const capture = activeCapture;
    if (!capture || capture.epoch !== scope.epoch) {
      throw sessionError(
        'KIT_AGENT_REALTIME_CAPTURE_NOT_ACTIVE',
        'No microphone capture is active.',
        'start_microphone_capture',
        false,
      );
    }
    activeCapture = null;
    try {
      await capture.handle.stop();
    } catch (cause) {
      const error = hostError(
        cause,
        'KIT_AGENT_REALTIME_MICROPHONE_STOP_FAILED',
        'The Host could not release the active microphone device.',
        'check_microphone_device_and_retry',
        true,
      );
      if (isCurrent(scope)) recordIssue(error, false);
      throw error;
    }
    dispatch({ type: 'capture-stopped', epoch: scope.epoch, state: captureState });
    try {
      const result = await input.agentRealtime.appendInput({
        ...scopeInput(scope),
        input: {
          type: 'capture-stopped',
          inputTrackId: capture.handle.inputTrackId,
          utteranceId: capture.handle.utteranceId,
        },
      });
      applyOperationResult(scope.epoch, result);
      return result;
    } catch (cause) {
      const error = runtimeError(
        cause,
        'report Agent Realtime capture stop',
        'reopen_agent_realtime_session',
      );
      if (isCurrent(scope)) recordIssue(error, true);
      throw error;
    }
  }

  async function enforceBlockedPressure(scope: ActiveSessionScope): Promise<void> {
    if (isCurrent(scope) && state.pressure === 'blocked'
      && activeCapture?.epoch === scope.epoch) {
      await stopCapture(scope, 'stopped');
    }
  }

  async function projectHostPlayback(
    scope: ActiveSessionScope,
    event: NimiAgentRealtimeEvent,
  ): Promise<void> {
    if (event.type === 'audio-frame') {
      if (state.playback === 'unavailable') {
        await interruptUnplayableTrack(scope, event.outputTrackId);
        return;
      }
      try {
        await input.host.playback.writeAudioFrame({
          outputTrackId: event.outputTrackId,
          frameSequence: event.frameSequence,
          frame: event.frame,
          format: event.format,
        });
      } catch (cause) {
        const error = playbackError(cause);
        dispatch({ type: 'playback-failed', epoch: scope.epoch, error });
        await interruptUnplayableTrack(scope, event.outputTrackId);
      }
      return;
    }
    if (event.type === 'output-track' && event.lifecycle !== 'active') {
      try {
        await input.host.playback.finishOutputTrack({
          outputTrackId: event.outputTrackId,
          lifecycle: event.lifecycle,
        });
      } catch (cause) {
        const error = playbackError(cause);
        dispatch({ type: 'playback-failed', epoch: scope.epoch, error });
      }
      playbackInterruptedTracks.delete(event.outputTrackId);
    }
  }

  async function interruptUnplayableTrack(
    scope: ActiveSessionScope,
    outputTrackId: string,
  ): Promise<void> {
    if (playbackInterruptedTracks.has(outputTrackId)) return;
    playbackInterruptedTracks.add(outputTrackId);
    try {
      await input.agentRealtime.interruptOutput({
        ...scopeInput(scope),
        outputTrackId,
        interruptAgentTurn: false,
      });
    } catch {
      // The playback failure remains the visible issue; Runtime owns the
      // subsequent terminal/status projection if interruption also fails.
    }
    try {
      await input.host.playback.interruptOutputTrack({ outputTrackId });
    } catch {
      // The original typed playback failure is already recorded.
    }
  }

  async function releaseTerminalMedia(scope: ActiveSessionScope): Promise<void> {
    await releaseCaptureWithoutObservation(scope, 'stopped');
    try {
      await input.host.playback.close();
    } catch (cause) {
      if (isCurrent(scope)) {
        dispatch({
          type: 'playback-failed',
          epoch: scope.epoch,
          error: playbackError(cause),
        });
      }
    }
  }

  async function releaseCaptureWithoutObservation(
    scope: ActiveSessionScope,
    captureState: 'stopped' | 'device-lost',
  ): Promise<void> {
    const capture = activeCapture;
    if (!capture || capture.epoch !== scope.epoch) return;
    activeCapture = null;
    try {
      await capture.handle.stop();
    } catch {
      // A terminal Runtime failure already prevents additional input; the Host
      // stop contract is idempotent and must release its exact device.
    }
    if (isCurrent(scope)) {
      dispatch({ type: 'capture-stopped', epoch: scope.epoch, state: captureState });
    }
  }

  async function stopCaptureForClosing(scope: ActiveSessionScope): Promise<void> {
    const capture = activeCapture;
    if (!capture || capture.epoch !== scope.epoch) return;
    activeCapture = null;
    await capture.handle.stop();
    await input.agentRealtime.appendInput({
      ...scopeInput(scope),
      input: {
        type: 'capture-stopped',
        inputTrackId: capture.handle.inputTrackId,
        utteranceId: capture.handle.utteranceId,
      },
    });
  }

  function requireActiveSession(operation: string): ActiveSessionScope {
    const scope = activeSession;
    if (!scope || !isCurrent(scope)
      || state.lifecycle === 'closing' || state.lifecycle === 'closed'
      || state.lifecycle === 'failed') {
      throw recordIssue(sessionError(
        'KIT_AGENT_REALTIME_SESSION_INACTIVE',
        `Cannot ${operation} without an active Agent Realtime session.`,
        'open_agent_realtime_session',
        true,
      ), false);
    }
    return scope;
  }

  function requireWritablePressure(epoch: number): void {
    if (state.pressure !== 'blocked') return;
    throw recordIssue(sessionError(
      'KIT_AGENT_REALTIME_INPUT_BLOCKED',
      'The Agent Realtime session cannot accept more input.',
      'wait_for_agent_realtime_pressure_recovery',
      true,
    ), false, epoch);
  }

  function applyOperationResult(epoch: number, result: NimiRealtimeOperationResult): void {
    dispatch({ type: 'control-observed', epoch, control: result.control });
    if (result.ack.ok) return;
    recordIssue(createNimiError({
      message: result.ack.reasonCode || 'Agent Realtime operation was rejected.',
      code: result.ack.reasonCode || 'KIT_AGENT_REALTIME_OPERATION_REJECTED',
      reasonCode: result.ack.reasonCode || 'KIT_AGENT_REALTIME_OPERATION_REJECTED',
      actionHint: result.ack.actionHint || 'inspect_agent_realtime_status',
      retryable: result.control.lifecycle !== 'failed' && result.control.lifecycle !== 'closed',
      source: 'runtime',
    }), result.control.lifecycle === 'failed' || result.control.lifecycle === 'closed', epoch);
  }

  function recordIssue(error: NimiError, terminal: boolean, epoch = state.sessionEpoch): NimiError {
    dispatch({ type: 'operation-failed', epoch, error, terminal });
    return error;
  }

  function isCurrent(scope: ActiveSessionScope): boolean {
    return state.sessionEpoch === scope.epoch && activeSession === scope;
  }

  return Object.freeze(controller);
}

function scopeInput(scope: ActiveSessionScope) {
  return {
    agentHandle: scope.agentHandle,
    realtimeSessionId: scope.realtimeSessionId,
    generation: scope.generation,
  } as const;
}

async function closeStaleOpen(
  client: NimiAgentRealtimeClient,
  scope: ActiveSessionScope,
): Promise<void> {
  await client.close(scopeInput(scope));
}

async function closeAfterSubscribeFailure(
  client: NimiAgentRealtimeClient,
  scope: ActiveSessionScope,
): Promise<void> {
  try {
    await client.close(scopeInput(scope));
  } catch {
    // The subscribe failure remains the causal typed error. Runtime will reap
    // the inaccessible session under its own lifecycle policy.
  }
}

function terminalControlError(result: NimiAgentRealtimeOpenResult): NimiError {
  const reasonCode = result.control.terminalReason || 'KIT_AGENT_REALTIME_OPEN_TERMINAL';
  return createNimiError({
    message: `Agent Realtime opened in terminal state: ${reasonCode}.`,
    code: reasonCode,
    reasonCode,
    actionHint: result.control.actionHint || 'inspect_agent_realtime_status',
    retryable: result.control.lifecycle !== 'closed',
    source: 'runtime',
  });
}

function runtimeError(
  cause: unknown,
  operation: string,
  actionHint: string,
): NimiError {
  return asNimiError(cause, {
    message: `Failed to ${operation}.`,
    code: 'KIT_AGENT_REALTIME_RUNTIME_FAILED',
    reasonCode: 'KIT_AGENT_REALTIME_RUNTIME_FAILED',
    actionHint,
    retryable: true,
    source: 'runtime',
  });
}

function hostError(
  cause: unknown,
  reasonCode: string,
  message: string,
  actionHint: string,
  retryable: boolean,
): NimiError {
  return asNimiError(cause, {
    message,
    code: reasonCode,
    reasonCode,
    actionHint,
    retryable,
    source: 'sdk',
  });
}

function playbackError(cause: unknown): NimiError {
  return hostError(
    cause,
    'KIT_AGENT_REALTIME_PLAYBACK_UNAVAILABLE',
    'The Host could not play Agent Realtime audio.',
    'check_audio_output_and_retry',
    true,
  );
}

function hostOrRuntimeCloseError(cause: unknown): NimiError {
  return asNimiError(cause, {
    message: 'Agent Realtime media could not be released cleanly.',
    code: 'KIT_AGENT_REALTIME_CLOSE_FAILED',
    reasonCode: 'KIT_AGENT_REALTIME_CLOSE_FAILED',
    actionHint: 'retry_agent_realtime_close',
    retryable: true,
    source: 'sdk',
  });
}

function sessionError(
  reasonCode: string,
  message: string,
  actionHint: string,
  retryable: boolean,
): NimiError {
  return createNimiError({
    message,
    code: reasonCode,
    reasonCode,
    actionHint,
    retryable,
    source: 'sdk',
  });
}

function staleEpochError(): NimiError {
  return sessionError(
    'KIT_AGENT_REALTIME_STALE_SESSION_EPOCH',
    'The Agent Realtime result belongs to an inactive session epoch.',
    'use_current_agent_realtime_session',
    true,
  );
}

function assertCaptureHandle(handle: NimiAgentRealtimeCaptureHandle): void {
  if (!handle || typeof handle !== 'object'
    || !safeSelector(handle.inputTrackId)
    || !safeSelector(handle.utteranceId)
    || typeof handle.stop !== 'function') {
    throw sessionError(
      'KIT_AGENT_REALTIME_CAPTURE_PROTOCOL_INVALID',
      'The Host returned an invalid microphone capture handle.',
      'repair_agent_realtime_host_media_port',
      false,
    );
  }
}

function safeSelector(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function notifyListener<T>(listener: (value: T) => void, value: T): void {
  try {
    listener(value);
  } catch {
    // Consumer callbacks cannot mutate or terminate the canonical session.
  }
}

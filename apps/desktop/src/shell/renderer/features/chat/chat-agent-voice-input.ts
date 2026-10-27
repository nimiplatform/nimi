import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isNimiRuntimeAgentCanceledError,
} from '@nimiplatform/sdk/runtime';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
  NimiLocalAppConversationVoiceTranscriptionResult,
} from '@nimiplatform/sdk/app';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types.js';
import type { DesktopRendererVoiceCapturePort } from '../../renderer/voice-capture-port.js';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { PendingAttachment } from '../turns/turn-input-attachments.js';
import type { AgentVoiceCaptureResult, AgentVoiceCaptureSession } from './chat-agent-voice-capture.js';
import { asNimiError, createNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import {
  createInitialAgentVoiceSessionShellState,
  type AgentVoiceTranscriptProjection,
  type AgentVoiceSessionShellState,
} from './chat-agent-voice-session.js';
import {
  startDesktopAgentRealtimeVoice,
  type DesktopAgentRealtimeVoiceSession,
} from './chat-agent-realtime-voice.js';

type AgentVoiceTranscriptionPort = {
  conversation(): Pick<NimiLocalAppConversationClient, 'transcribeVoice'>;
};
type AgentVoiceInputRuntimePort = Pick<DesktopRendererSdkPort, 'appProduct'> & AgentVoiceTranscriptionPort;

type AgentVoiceInputSubmit = (input: {
  text: string;
  attachments: readonly PendingAttachment[];
}) => Promise<void>;

type RecordedVoiceOperation = {
  readonly controller: AbortController;
  readonly target: AgentLocalTargetSnapshot;
  conversationAnchorId: string;
  capture: AgentVoiceCaptureSession | null;
};

type RealtimeVoiceOperation = {
  readonly controller: AbortController;
  readonly agentHandle: string | null | undefined;
  conversationAnchorId: string | null;
  session: DesktopAgentRealtimeVoiceSession | null;
  canceled: boolean;
  closing: boolean;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isAgentVoiceConfigurationFailure(reasonCode: string): boolean {
  return [
    'AI_CONFIG_INVALID',
    'AI_CONFIG_NOT_FOUND',
    'AGENT_AI_CONFIG_CAPABILITY_MISMATCH',
    'AI_LOCAL_SELECTION_NOT_FOUND',
    'AI_LOCAL_DRIVER_UNAVAILABLE',
    'AI_ROUTE_UNSUPPORTED',
  ].includes(reasonCode);
}

function agentVoiceRecovery(error: unknown, reasonCode: string, kind: 'recorded' | 'realtime'): {
  readonly message: string | null;
  readonly actionHint: string | null;
} {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return {
        message: 'Microphone access was denied. Allow microphone access, then try again.',
        actionHint: 'allow_microphone_access',
      };
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return {
        message: 'No microphone is available. Connect or select a microphone, then try again.',
        actionHint: 'check_microphone_device',
      };
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return {
        message: 'The microphone could not be opened. Close other microphone users, then try again.',
        actionHint: 'release_microphone_device',
      };
    }
  }
  if (reasonCode === 'AI_VOICE_INPUT_INVALID') {
    return {
      message: 'Voice input was rejected. Check the microphone signal and try speaking again.',
      actionHint: 'retry_voice_input',
    };
  }
  if (reasonCode === 'AI_REALTIME_SESSION_CLOSED') {
    return {
      message: 'The realtime voice session ended before the reply finished. Start realtime voice again.',
      actionHint: 'reopen_realtime_session',
    };
  }
  if (reasonCode === 'AI_MODALITY_NOT_SUPPORTED') {
    return {
      message: 'The selected Realtime route does not support this microphone audio format.',
      actionHint: 'configure_realtime_interact_route',
    };
  }
  if (isAgentVoiceConfigurationFailure(reasonCode)) {
    return {
      message: kind === 'recorded'
        ? 'Voice messages need a speech-to-text model. Choose Audio transcription in Agent Center > Models, then record again.'
        : 'Realtime voice is not configured. Configure the Agent Realtime model, then try again.',
      actionHint: kind === 'recorded' ? 'configure_audio_transcribe_route' : 'configure_realtime_interact_route',
    };
  }
  return { message: null, actionHint: null };
}

export function readableAgentVoiceError(error: unknown, fallbackMessage: string, kind: 'recorded' | 'realtime' = 'realtime') {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: 'inspect_agent_realtime_voice',
    source: 'runtime',
  });
  const configurationFailure = isAgentVoiceConfigurationFailure(normalized.reasonCode);
  const recovery = agentVoiceRecovery(error, normalized.reasonCode, kind);
  return createNimiError({
    message: recovery.message || fallbackMessage,
    reasonCode: normalized.reasonCode,
    actionHint: recovery.actionHint || (configurationFailure
      ? 'configure_realtime_interact_route'
      : normalized.actionHint),
    retryable: normalized.retryable,
    source: normalized.source,
  });
}

// Recorded STT and Realtime remain separate explicit user actions.
export function isAgentVoiceInputCancellationError(error: unknown): boolean {
  return isNimiRuntimeAgentCanceledError(error)
    || (error instanceof DOMException && error.name === 'AbortError');
}

export async function transcribeAndSubmitCapturedAgentVoiceInput(input: {
  runtime: AgentVoiceTranscriptionPort;
  target: AgentLocalTargetSnapshot;
  conversationAnchorId: string;
  bytes: Uint8Array;
  mimeType: string;
  signal?: AbortSignal;
  handleSubmit: AgentVoiceInputSubmit;
  beforeSubmit?: () => boolean;
}): Promise<NimiLocalAppConversationVoiceTranscriptionResult & { submitted: boolean }> {
  const agentHandle = normalizeText(input.target.agentHandle);
  if (!agentHandle) throw new Error('Recorded voice transcription requires the current Agent handle.');
  const result = await input.runtime.conversation().transcribeVoice({
    agentHandle: agentHandle as NimiLocalAppAgentHandle,
    conversationAnchorId: input.conversationAnchorId,
    requestId: `desktop-recorded-voice-${globalThis.crypto.randomUUID()}`,
    audioBytes: input.bytes,
    mimeType: input.mimeType,
  }, { signal: input.signal });
  if (input.signal?.aborted || (input.beforeSubmit && !input.beforeSubmit())) {
    return { ...result, submitted: false };
  }
  await input.handleSubmit({ text: result.text, attachments: [] });
  return { ...result, submitted: true };
}

export function useAgentConversationVoiceInput(input: {
  enabled: boolean;
  target: AgentLocalTargetSnapshot | null;
  voiceCapture: DesktopRendererVoiceCapturePort;
  runtime: AgentVoiceInputRuntimePort;
  ensureConversationAnchor: () => Promise<string>;
  getCurrentConversationAnchorId: () => string | null;
  handleSubmit: AgentVoiceInputSubmit;
  reportError: (error: unknown, options?: { action?: string }) => void;
  failureMessage: string;
}) {
  const [state, setState] = useState<AgentVoiceSessionShellState>(createInitialAgentVoiceSessionShellState);
  const [amplitude, setAmplitude] = useState(0);
  // Realtime ASR stays in this mounted view only. Runtime Agent Service remains
  // the sole owner that commits the final user turn into Conversation truth.
  const [transcript, setTranscript] = useState<AgentVoiceTranscriptProjection | null>(null);
  const stateRef = useRef(state);
  const realtimeRef = useRef<DesktopAgentRealtimeVoiceSession | null>(null);
  const realtimeOperationRef = useRef<RealtimeVoiceOperation | null>(null);
  const playbackBlockedRef = useRef(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const recordedRef = useRef<RecordedVoiceOperation | null>(null);
  const latestInputRef = useRef(input);
  latestInputRef.current = input;
  const [voiceKind, setVoiceKind] = useState<'recorded' | 'realtime'>('recorded');
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const actionPendingRef = useRef(false);
  const mountedRef = useRef(true);

  const blockPlayback = useCallback((blocked: boolean) => {
    playbackBlockedRef.current = blocked;
    if (mountedRef.current) setPlaybackBlocked(blocked);
  }, []);

  const commitState = useCallback((next: AgentVoiceSessionShellState) => {
    stateRef.current = next;
    if (mountedRef.current) setState(next);
  }, []);

  const resetToIdle = useCallback(() => {
    if (mountedRef.current) {
      setAmplitude(0);
      setTranscript(null);
    }
    commitState(createInitialAgentVoiceSessionShellState());
  }, [commitState]);

  const fail = useCallback((error: unknown, conversationAnchorId: string | null) => {
    if (isAgentVoiceInputCancellationError(error) && !realtimeOperationRef.current) {
      resetToIdle();
      return;
    }
    const currentInput = latestInputRef.current;
    currentInput.reportError(readableAgentVoiceError(error, currentInput.failureMessage), {
      action: 'agent-realtime-voice',
    });
    if (mountedRef.current) {
      setAmplitude(0);
      setTranscript(null);
    }
    commitState({
      status: 'failed',
      mode: 'push-to-talk',
      conversationAnchorId,
      message: currentInput.failureMessage,
    });
  }, [commitState, resetToIdle]);

  const cancel = useCallback(() => {
    const recorded = recordedRef.current;
    recordedRef.current = null;
    recorded?.controller.abort();
    recorded?.capture?.cancel();
    const operation = realtimeOperationRef.current;
    if (!operation) { resetToIdle(); return; }
    operation.canceled = true;
    blockPlayback(true);
    if (operation.conversationAnchorId) commitState({ status: 'transcribing', mode: 'push-to-talk', conversationAnchorId: operation.conversationAnchorId, message: null });
    if (!operation.session) { operation.controller.abort(); return; }
    if (operation.closing) return;
    operation.closing = true;
    if (mountedRef.current) setClosing(true);
    void operation.session.stop().catch(error => {
      if (realtimeOperationRef.current === operation
        || !realtimeOperationRef.current && latestInputRef.current.target?.agentHandle === operation.agentHandle) {
        fail(error, operation.conversationAnchorId);
      }
    }).finally(() => { operation.closing = false; if (mountedRef.current) setClosing(false); });
  }, [blockPlayback, commitState, fail, resetToIdle]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recorded = recordedRef.current;
      recordedRef.current = null;
      recorded?.controller.abort();
      recorded?.capture?.cancel();
      const operation = realtimeOperationRef.current;
      if (operation) operation.canceled = true;
      operation?.controller.abort();
      void operation?.session?.close().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    cancel();
  }, [cancel, input.target?.agentHandle]);

  useEffect(() => {
    const anchor = stateRef.current.conversationAnchorId;
    if (anchor && anchor !== normalizeText(input.target?.conversationAnchorId)) cancel();
  }, [cancel, input.target?.conversationAnchorId]);

  const toggleRealtime = useCallback(() => {
    if (recordedRef.current) return;
    const operation = realtimeOperationRef.current;
    if (operation?.canceled || stateRef.current.status === 'failed' && operation) { cancel(); return; }
    if (actionPendingRef.current) return;
    const current = realtimeRef.current;
    if (current) {
      if (stateRef.current.status !== 'listening') return;
      actionPendingRef.current = true;
      commitState({
        status: 'transcribing',
        mode: 'push-to-talk',
        conversationAnchorId: stateRef.current.conversationAnchorId,
        message: null,
      });
      void current.finishInput().catch((error) => {
        return current.close().catch(closeError => {
          if (realtimeOperationRef.current === operation) fail(closeError, operation?.conversationAnchorId ?? null);
        }).then(() => { if (!operation?.canceled) fail(error, operation?.conversationAnchorId ?? null); });
      }).finally(() => {
        actionPendingRef.current = false;
      });
      return;
    }
    const target = input.target;
    if (!input.enabled || !target || playbackBlockedRef.current) return;
    const nextOperation: RealtimeVoiceOperation = { controller: new AbortController(), agentHandle: target.agentHandle,
      conversationAnchorId: null, session: null, canceled: false, closing: false };
    realtimeOperationRef.current = nextOperation;
    blockPlayback(true);
    setVoiceKind('realtime');
    setOpening(true);
    setTranscript(null);
    actionPendingRef.current = true;
    void (async () => {
      let conversationAnchorId: string | null = null;
      try {
        conversationAnchorId = normalizeText(await input.ensureConversationAnchor());
        if (nextOperation.canceled || !mountedRef.current || latestInputRef.current.target?.agentHandle !== target.agentHandle) {
          if (realtimeOperationRef.current === nextOperation) { realtimeOperationRef.current = null; blockPlayback(false); resetToIdle(); }
          return;
        }
        if (!conversationAnchorId) throw new Error('Runtime Agent Realtime requires an active canonical Conversation.');
        const activeAnchor = conversationAnchorId;
        nextOperation.conversationAnchorId = activeAnchor;
        const session = await startDesktopAgentRealtimeVoice({
          client: input.runtime.appProduct().agentRealtime,
          target,
          conversationAnchorId: activeAnchor,
          signal: nextOperation.controller.signal,
          onSession: session => {
            nextOperation.session = session;
            if (realtimeOperationRef.current === nextOperation) realtimeRef.current = session;
          },
          callbacks: {
            onAmplitude: (value) => { if (mountedRef.current && realtimeOperationRef.current === nextOperation && !nextOperation.canceled) setAmplitude(value); },
            onTranscript: (text, final) => {
              if (!mountedRef.current || realtimeOperationRef.current !== nextOperation || nextOperation.canceled) return;
              const normalizedTranscript = normalizeText(text);
              if (normalizedTranscript) {
                setTranscript({ text: normalizedTranscript, final });
              }
              commitState({
                status: final ? 'transcribing' : 'listening',
                mode: 'push-to-talk',
                conversationAnchorId: activeAnchor,
                message: null,
              });
              if (final) {
                commitState({ status: 'transcribing', mode: 'push-to-talk', conversationAnchorId: activeAnchor, message: null });
              }
            },
            onOutputActive: (active) => {
			if (!mountedRef.current || realtimeOperationRef.current !== nextOperation || nextOperation.canceled) return;
			commitState({
				status: active ? 'playing' : 'transcribing',
				mode: 'push-to-talk',
				conversationAnchorId: activeAnchor,
				message: null,
			});
		},
            onClosed: () => {
              if (realtimeOperationRef.current !== nextOperation) return;
              realtimeOperationRef.current = null;
              realtimeRef.current = null;
              blockPlayback(false);
              if (mountedRef.current) resetToIdle();
            },
            onError: (error) => {
              if (realtimeOperationRef.current === nextOperation || !realtimeOperationRef.current && !nextOperation.canceled) fail(error, activeAnchor);
            },
          },
        });
        if (!mountedRef.current || realtimeOperationRef.current !== nextOperation || nextOperation.canceled || latestInputRef.current.target?.agentHandle !== target.agentHandle) {
          await session.close();
          return;
        }
        realtimeRef.current = session;
        commitState({ status: 'listening', mode: 'push-to-talk', conversationAnchorId: activeAnchor, message: null });
      } catch (error) {
        if (realtimeOperationRef.current === nextOperation && !nextOperation.session) {
          realtimeOperationRef.current = null;
          realtimeRef.current = null;
          blockPlayback(false);
        }
        if (realtimeOperationRef.current === nextOperation || !nextOperation.canceled) fail(error, conversationAnchorId);
      }
    })().finally(() => {
      actionPendingRef.current = false;
      if (mountedRef.current) setOpening(false);
    });
  }, [blockPlayback, cancel, commitState, fail, input, resetToIdle]);

  // @nimi-authority: rule.nimi.desktop.agent-projection.r011
  const finishRecorded = useCallback(async (
    operation: RecordedVoiceOperation,
    recording: Promise<AgentVoiceCaptureResult>,
  ) => {
    if (recordedRef.current !== operation) {
      await recording.catch(() => undefined);
      return;
    }
    operation.capture = null;
    actionPendingRef.current = true;
    commitState({ status: 'transcribing', mode: 'push-to-talk', conversationAnchorId: operation.conversationAnchorId, message: null });
    try {
      const captured = await recording;
      if (operation.controller.signal.aborted || recordedRef.current !== operation) return;
      await transcribeAndSubmitCapturedAgentVoiceInput({
        runtime: latestInputRef.current.runtime,
        target: operation.target,
        conversationAnchorId: operation.conversationAnchorId,
        ...captured,
        signal: operation.controller.signal,
        handleSubmit: (request) => latestInputRef.current.handleSubmit(request),
        beforeSubmit: () => recordedRef.current === operation
          && latestInputRef.current.target?.agentHandle === operation.target.agentHandle
          && latestInputRef.current.getCurrentConversationAnchorId() === operation.conversationAnchorId,
      });
      if (recordedRef.current === operation) resetToIdle();
    } catch (error) {
      if (operation.controller.signal.aborted || recordedRef.current !== operation) return;
      if (isAgentVoiceInputCancellationError(error)) {
        resetToIdle();
      } else {
        const readable = readableAgentVoiceError(error, latestInputRef.current.failureMessage, 'recorded');
        latestInputRef.current.reportError(readable, { action: 'agent-recorded-voice' });
        commitState({ status: 'failed', mode: 'push-to-talk', conversationAnchorId: operation.conversationAnchorId, message: readable.message });
      }
    } finally {
      if (recordedRef.current === operation) recordedRef.current = null;
      actionPendingRef.current = false;
    }
  }, [commitState, resetToIdle]);

  const toggle = useCallback(() => {
    if (playbackBlockedRef.current) {
      toggleRealtime();
      return;
    }
    if (actionPendingRef.current) return;
    const current = recordedRef.current;
    if (current?.capture) {
      void finishRecorded(current, current.capture.stop());
      return;
    }
    if (current || !input.enabled || !input.target) return;
    const operation: RecordedVoiceOperation = {
      controller: new AbortController(), target: input.target, conversationAnchorId: '', capture: null,
    };
    recordedRef.current = operation;
    actionPendingRef.current = true;
    setVoiceKind('recorded');
    setOpening(true);
    setTranscript(null);
    void (async () => {
      try {
        operation.conversationAnchorId = normalizeText(await input.ensureConversationAnchor());
        if (!operation.conversationAnchorId) throw new Error('Recorded voice requires an active Conversation.');
        if (operation.controller.signal.aborted || recordedRef.current !== operation) return;
        const capture = await input.voiceCapture.start({
          autoStopMode: 'manual',
          onLevelChange: (value) => {
            if (mountedRef.current && recordedRef.current === operation) setAmplitude(value);
          },
          onAutoStop: (recording) => { void finishRecorded(operation, recording); },
        });
        if (operation.controller.signal.aborted || recordedRef.current !== operation) {
          capture.cancel();
          return;
        }
        operation.capture = capture;
        commitState({ status: 'listening', mode: 'push-to-talk', conversationAnchorId: operation.conversationAnchorId, message: null });
      } catch (error) {
        if (operation.controller.signal.aborted || recordedRef.current !== operation) return;
        recordedRef.current = null;
        if (isAgentVoiceInputCancellationError(error)) resetToIdle();
        else {
          const readable = readableAgentVoiceError(error, input.failureMessage, 'recorded');
          input.reportError(readable, { action: 'agent-recorded-voice' });
          commitState({ status: 'failed', mode: 'push-to-talk', conversationAnchorId: operation.conversationAnchorId || null, message: readable.message });
        }
      } finally {
        actionPendingRef.current = false;
        if (mountedRef.current) setOpening(false);
      }
    })();
  }, [commitState, finishRecorded, input, resetToIdle, toggleRealtime]);

  const realtimeActive = voiceKind === 'realtime' && playbackBlocked;

  return {
    available: Boolean(input.target),
    opening,
    playbackBlocked,
    state,
    captureState: { active: state.status === 'listening', amplitude },
    transcript,
    onToggle: toggle,
    onCancel: cancel,
    realtimeAction: {
      active: realtimeActive,
      disabled: Boolean(recordedRef.current) || closing || (!realtimeActive && !input.enabled),
      onToggle: () => {
        if (realtimeOperationRef.current) cancel();
        else toggleRealtime();
      },
    },
  };
}

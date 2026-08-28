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
import type { PendingAttachment } from '../turns/turn-input-attachments.js';
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

type AgentVoiceInputRuntimePort = {
  conversation(): Pick<NimiLocalAppConversationClient, 'transcribeVoice'>;
};

type AgentVoiceInputSubmit = (input: {
  text: string;
  attachments: readonly PendingAttachment[];
}) => Promise<void>;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRealtimeVoiceConfigurationFailure(reasonCode: string): boolean {
  return [
    'AI_CONFIG_INVALID',
    'AI_CONFIG_NOT_FOUND',
    'AI_LOCAL_SELECTION_NOT_FOUND',
    'AI_LOCAL_DRIVER_UNAVAILABLE',
    'AI_ROUTE_UNSUPPORTED',
  ].includes(reasonCode);
}

function realtimeVoiceRecovery(error: unknown, reasonCode: string): {
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
  if (reasonCode === 'AI_MODALITY_NOT_SUPPORTED') {
    return {
      message: 'The selected Realtime route does not support this microphone audio format.',
      actionHint: 'configure_realtime_interact_route',
    };
  }
  if (isRealtimeVoiceConfigurationFailure(reasonCode)) {
    return {
      message: 'Realtime voice is not configured. Configure the Agent Realtime model, then try again.',
      actionHint: 'configure_realtime_interact_route',
    };
  }
  return { message: null, actionHint: null };
}

export function readableRealtimeVoiceError(error: unknown, fallbackMessage: string) {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: 'inspect_agent_realtime_voice',
    source: 'runtime',
  });
  const configurationFailure = isRealtimeVoiceConfigurationFailure(normalized.reasonCode);
  const recovery = realtimeVoiceRecovery(error, normalized.reasonCode);
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

// Recorded STT remains an explicit non-Realtime product operation. The
// formal microphone button below no longer calls it as a Voice fallback.
export function isAgentVoiceInputCancellationError(error: unknown): boolean {
  return isNimiRuntimeAgentCanceledError(error)
    || (error instanceof DOMException && error.name === 'AbortError');
}

export async function transcribeAndSubmitCapturedAgentVoiceInput(input: {
  runtime: AgentVoiceInputRuntimePort;
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
  const actionPendingRef = useRef(false);
  const mountedRef = useRef(true);

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
    if (isAgentVoiceInputCancellationError(error)) {
      resetToIdle();
      return;
    }
    input.reportError(readableRealtimeVoiceError(error, input.failureMessage), {
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
      message: input.failureMessage,
    });
  }, [commitState, input.failureMessage, input.reportError, resetToIdle]);

  const cancel = useCallback(() => {
    const current = realtimeRef.current;
    realtimeRef.current = null;
    const anchor = stateRef.current.conversationAnchorId;
    void current?.stop().catch((error) => fail(error, anchor));
    resetToIdle();
  }, [fail, resetToIdle]);

  useEffect(() => () => {
    mountedRef.current = false;
    const current = realtimeRef.current;
    realtimeRef.current = null;
    void current?.close();
  }, []);

  useEffect(() => {
    cancel();
  }, [cancel, input.target?.agentHandle, input.target?.conversationAnchorId]);

  const toggle = useCallback(() => {
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
		realtimeRef.current = null;
		return current.close().finally(() => {
			fail(error, stateRef.current.conversationAnchorId);
		});
      }).finally(() => {
        actionPendingRef.current = false;
      });
      return;
    }
    const target = input.target;
    if (!input.enabled || !target) return;
    setTranscript(null);
    actionPendingRef.current = true;
    void (async () => {
      let conversationAnchorId: string | null = null;
      try {
        conversationAnchorId = normalizeText(await input.ensureConversationAnchor());
        if (!conversationAnchorId) throw new Error('Runtime Agent Realtime requires an active canonical Conversation.');
        const activeAnchor = conversationAnchorId;
        const session = await startDesktopAgentRealtimeVoice({
          target,
          conversationAnchorId: activeAnchor,
          callbacks: {
            onAmplitude: (value) => { if (mountedRef.current) setAmplitude(value); },
            onTranscript: (text, final) => {
              if (!mountedRef.current || realtimeRef.current === null) return;
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
			if (!mountedRef.current || realtimeRef.current === null) return;
			commitState({
				status: active ? 'playing' : 'transcribing',
				mode: 'push-to-talk',
				conversationAnchorId: activeAnchor,
				message: null,
			});
		},
            onClosed: () => {
              realtimeRef.current = null;
              if (mountedRef.current && stateRef.current.status !== 'failed') resetToIdle();
            },
            onError: (error) => fail(error, activeAnchor),
          },
        });
        if (!mountedRef.current) {
          await session.close();
          return;
        }
        realtimeRef.current = session;
        commitState({ status: 'listening', mode: 'push-to-talk', conversationAnchorId: activeAnchor, message: null });
      } catch (error) {
        fail(error, conversationAnchorId);
      }
    })().finally(() => {
      actionPendingRef.current = false;
    });
  }, [cancel, commitState, fail, input, resetToIdle]);

  return {
    available: Boolean(input.target),
    state,
    captureState: { active: state.status === 'listening', amplitude },
    transcript,
    onToggle: toggle,
    onCancel: cancel,
  };
}

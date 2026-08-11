import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  createNimiRuntimeAgentTurnsModule,
  isNimiRuntimeAgentCanceledError,
  type NimiRuntimeAgentScopeRunner,
  type NimiRuntimeAgentTurnsRuntime,
  type NimiRuntimeAgentVoiceInputTranscriptionResult,
} from '@nimiplatform/sdk/runtime';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types.js';
import type { DesktopRendererVoiceCapturePort } from '../../renderer/voice-capture-port.js';
import type { PendingAttachment } from '../turns/turn-input-attachments.js';
import {
  createInitialAgentVoiceSessionShellState,
  resolveIdleAgentVoiceSessionShellState,
  type AgentVoiceSessionShellState,
} from './chat-agent-voice-session.js';
import type { AgentVoiceCaptureResult } from './chat-agent-voice-capture.js';

type AgentVoiceInputRuntimePort = {
  runtimeAgentTurns(): NimiRuntimeAgentTurnsRuntime;
  withRuntimeProtectedScopes: NimiRuntimeAgentScopeRunner;
};

type AgentVoiceInputSubmit = (input: {
  text: string;
  attachments: readonly PendingAttachment[];
}) => Promise<void>;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isAgentVoiceInputCancellationError(error: unknown): boolean {
  return isNimiRuntimeAgentCanceledError(error);
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
}): Promise<NimiRuntimeAgentVoiceInputTranscriptionResult & { submitted: boolean }> {
  const turns = createNimiRuntimeAgentTurnsModule({
    runtime: input.runtime.runtimeAgentTurns(),
    getSubjectUserId: () => input.target.ownerUserId,
    withScopes: input.runtime.withRuntimeProtectedScopes,
  });
  const result = await turns.transcribeVoiceInput({
    ownerUserId: input.target.ownerUserId,
    runtimeSourceRef: input.target.runtimeSourceRef,
    localAgentRef: input.target.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    audioBytes: input.bytes,
    mimeType: input.mimeType,
    signal: input.signal,
  });
  if (input.beforeSubmit && !input.beforeSubmit()) {
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
  const [state, setState] = useState<AgentVoiceSessionShellState>(
    createInitialAgentVoiceSessionShellState,
  );
  const [amplitude, setAmplitude] = useState(0);
  const stateRef = useRef(state);
  const captureSessionRef = useRef<Awaited<ReturnType<DesktopRendererVoiceCapturePort['start']>> | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);
  const actionPendingRef = useRef(false);
  const mountedRef = useRef(true);

  const commitState = useCallback((next: AgentVoiceSessionShellState) => {
    stateRef.current = next;
    if (mountedRef.current) {
      setState(next);
    }
  }, []);

  const resetToIdle = useCallback(() => {
    if (mountedRef.current) {
      setAmplitude(0);
    }
    commitState(resolveIdleAgentVoiceSessionShellState(stateRef.current.mode));
  }, [commitState]);

  const cancel = useCallback(() => {
    operationRef.current += 1;
    captureSessionRef.current?.cancel();
    captureSessionRef.current = null;
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    resetToIdle();
  }, [resetToIdle]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      captureSessionRef.current?.cancel();
      captureSessionRef.current = null;
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    cancel();
  }, [cancel, input.target?.localAgentRef, input.target?.ownerUserId, input.target?.runtimeSourceRef]);

  const fail = useCallback((error: unknown, conversationAnchorId: string | null) => {
    if (isAgentVoiceInputCancellationError(error)) {
      resetToIdle();
      return;
    }
    input.reportError(error, { action: 'agent-voice-input' });
    if (mountedRef.current) {
      setAmplitude(0);
    }
    commitState({
      status: 'failed',
      mode: stateRef.current.mode,
      conversationAnchorId,
      message: input.failureMessage,
    });
  }, [commitState, input, resetToIdle]);

  const transcribeRecording = useCallback(async (recording: Promise<AgentVoiceCaptureResult>, options: {
    target: AgentLocalTargetSnapshot;
    conversationAnchorId: string;
    operation: number;
  }) => {
    const abortController = new AbortController();
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = abortController;
    commitState({
      status: 'transcribing',
      mode: stateRef.current.mode,
      conversationAnchorId: options.conversationAnchorId,
      message: null,
    });
    if (mountedRef.current) {
      setAmplitude(0);
    }
    try {
      const captured = await recording;
      await transcribeAndSubmitCapturedAgentVoiceInput({
        runtime: input.runtime,
        target: options.target,
        conversationAnchorId: options.conversationAnchorId,
        bytes: captured.bytes,
        mimeType: captured.mimeType,
        signal: abortController.signal,
        handleSubmit: input.handleSubmit,
        beforeSubmit: () => (
          operationRef.current === options.operation
          && normalizeText(input.getCurrentConversationAnchorId()) === options.conversationAnchorId
        ),
      });
      if (operationRef.current === options.operation) {
        resetToIdle();
      }
    } catch (error) {
      if (operationRef.current === options.operation) {
        fail(error, options.conversationAnchorId);
      }
    } finally {
      if (transcriptionAbortRef.current === abortController) {
        transcriptionAbortRef.current = null;
      }
    }
  }, [commitState, fail, input, resetToIdle]);

  const toggle = useCallback(() => {
    if (actionPendingRef.current || stateRef.current.status === 'transcribing') {
      return;
    }
    const target = input.target;
    const listening = stateRef.current.status === 'listening';
    if (!listening && (!input.enabled || !target)) {
      return;
    }
    actionPendingRef.current = true;
    void (async () => {
      if (listening) {
        const session = captureSessionRef.current;
        const conversationAnchorId = stateRef.current.conversationAnchorId;
        if (!session || !conversationAnchorId || !target) {
          resetToIdle();
          return;
        }
        captureSessionRef.current = null;
        const operation = operationRef.current;
        await transcribeRecording(session.stop(), {
          target,
          conversationAnchorId,
          operation,
        });
        return;
      }

      if (!target) {
        resetToIdle();
        return;
      }

      const operation = operationRef.current + 1;
      operationRef.current = operation;
      let conversationAnchorId: string | null = null;
      try {
        conversationAnchorId = normalizeText(await input.ensureConversationAnchor());
        if (!conversationAnchorId) {
          throw new Error('Runtime Agent voice input requires an active conversation.');
        }
        const activeConversationAnchorId = conversationAnchorId;
        const autoStopState: { recording: Promise<AgentVoiceCaptureResult> | null } = {
          recording: null,
        };
        const handleAutoStop = (recording: Promise<AgentVoiceCaptureResult>) => {
          if (operationRef.current !== operation || !mountedRef.current) {
            void recording.catch(() => undefined);
            return;
          }
          if (!captureSessionRef.current) {
            autoStopState.recording = recording;
            return;
          }
          captureSessionRef.current = null;
          void transcribeRecording(recording, {
            target,
            conversationAnchorId: activeConversationAnchorId,
            operation,
          });
        };
        const session = await input.voiceCapture.start({
          autoStopMode: 'manual',
          onAutoStop: handleAutoStop,
          onLevelChange: (nextAmplitude) => {
            if (mountedRef.current && operationRef.current === operation) {
              setAmplitude(nextAmplitude);
            }
          },
        });
        if (operationRef.current !== operation || !mountedRef.current) {
          void autoStopState.recording?.catch(() => undefined);
          session.cancel();
          return;
        }
        captureSessionRef.current = session;
        commitState({
          status: 'listening',
          mode: stateRef.current.mode,
          conversationAnchorId: activeConversationAnchorId,
          message: null,
        });
        const pendingAutoStop = autoStopState.recording;
        if (pendingAutoStop) {
          captureSessionRef.current = null;
          void transcribeRecording(pendingAutoStop, {
            target,
            conversationAnchorId: activeConversationAnchorId,
            operation,
          });
        }
      } catch (error) {
        if (operationRef.current === operation) {
          fail(error, conversationAnchorId);
        }
      }
    })().finally(() => {
      actionPendingRef.current = false;
    });
  }, [commitState, fail, input, resetToIdle, transcribeRecording]);

  return {
    available: Boolean(input.target),
    state,
    captureState: {
      active: state.status === 'listening',
      amplitude,
    },
    onToggle: toggle,
    onCancel: cancel,
  };
}

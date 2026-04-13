import {
  useCallback,
  useEffect,
  useMemo,
  type MutableRefObject,
  useRef,
  useState,
} from 'react';
import type { TFunction } from 'i18next';
import type { AgentLocalMessageRecord } from '@renderer/bridge/runtime-bridge/types';
import { cancelStream } from '../turns/stream-controller';
import {
  createAISnapshot,
  type AgentEffectiveCapabilityResolution,
  type AIConfig,
  type ConversationCapabilityProjection,
} from './conversation-capability';
import { parseAgentChatVoiceWorkflowMetadata } from './chat-agent-voice-workflow';
import { reconcileAgentChatVoiceWorkflowMessage } from './chat-agent-voice-workflow-tracker';
import {
  transcribeChatAgentVoiceRuntime,
  toChatAgentRuntimeError,
  type ChatAgentVoiceWorkflowReferenceAudio,
} from './chat-agent-runtime';
import {
  startAgentVoiceCaptureSession,
  type AgentVoiceCaptureSession,
} from './chat-agent-voice-capture';
import {
  createInitialAgentVoiceSessionShellState,
  type AgentVoiceSessionMode,
  resolveIdleAgentVoiceSessionShellState,
  type AgentVoiceSessionShellState,
} from './chat-agent-voice-session';
import { toErrorMessage } from './chat-agent-shell-core';

function resolveIsVoiceSessionForeground(): boolean {
  if (typeof document === 'undefined') {
    return true;
  }
  const visible = document.visibilityState !== 'hidden';
  const focused = typeof document.hasFocus === 'function'
    ? document.hasFocus()
    : true;
  return visible && focused;
}

type UseAgentConversationVoiceSessionInput = {
  activeTarget: { agentId: string } | null;
  activeThreadId: string | null;
  aiConfig: AIConfig;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  bundleMessages: readonly AgentLocalMessageRecord[] | undefined;
  persistVoiceTranscriptDraft: (text: string) => Promise<void>;
  reportHostError: (error: unknown) => void;
  setBundleCache: (
    threadId: string,
    updater: (current: import('@renderer/bridge/runtime-bridge/types').AgentLocalThreadBundle | null | undefined) =>
      import('@renderer/bridge/runtime-bridge/types').AgentLocalThreadBundle | null | undefined,
  ) => void;
  submittingThreadId: string | null;
  t: TFunction;
  transcribeCapabilityProjection: ConversationCapabilityProjection | null;
  voiceCapabilityProjection: ConversationCapabilityProjection | null;
};

export function useAgentConversationVoiceSession(
  input: UseAgentConversationVoiceSessionInput,
): {
  clearLatestVoiceCaptureForThread: (threadId: string) => void;
  handsFreeState: {
    mode: AgentVoiceSessionMode;
    status: AgentVoiceSessionShellState['status'];
    disabled: boolean;
    onEnter: () => void;
    onExit: () => void;
  };
  latestVoiceCaptureByThreadRef: MutableRefObject<Record<string, ChatAgentVoiceWorkflowReferenceAudio | undefined>>;
  onVoiceSessionCancel: () => void;
  onVoiceSessionToggle: () => void;
  voiceSessionState: AgentVoiceSessionShellState;
} {
  const [voiceSessionState, setVoiceSessionState] = useState<AgentVoiceSessionShellState>(
    () => createInitialAgentVoiceSessionShellState(),
  );
  const [isVoiceSessionForeground, setIsVoiceSessionForeground] = useState<boolean>(
    () => resolveIsVoiceSessionForeground(),
  );
  const latestVoiceCaptureByThreadRef = useRef<Record<string, ChatAgentVoiceWorkflowReferenceAudio | undefined>>({});
  const voiceCaptureSessionRef = useRef<AgentVoiceCaptureSession | null>(null);
  const voiceTranscribeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const resetVoiceSession = () => {
      voiceTranscribeAbortRef.current?.abort();
      voiceTranscribeAbortRef.current = null;
      voiceCaptureSessionRef.current?.cancel();
      voiceCaptureSessionRef.current = null;
      setVoiceSessionState(createInitialAgentVoiceSessionShellState());
    };
    resetVoiceSession();
    return resetVoiceSession;
  }, [input.activeTarget?.agentId, input.activeThreadId]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }
    const syncForegroundState = () => {
      setIsVoiceSessionForeground(resolveIsVoiceSessionForeground());
    };
    syncForegroundState();
    document.addEventListener('visibilitychange', syncForegroundState);
    window.addEventListener('focus', syncForegroundState);
    window.addEventListener('blur', syncForegroundState);
    return () => {
      document.removeEventListener('visibilitychange', syncForegroundState);
      window.removeEventListener('focus', syncForegroundState);
      window.removeEventListener('blur', syncForegroundState);
    };
  }, []);

  useEffect(() => {
    if (!input.activeThreadId || !input.bundleMessages?.length) {
      return undefined;
    }
    const activeThreadId = input.activeThreadId;
    const pendingMessages = input.bundleMessages.filter((message) => {
      const metadata = parseAgentChatVoiceWorkflowMetadata(message.metadataJson);
      return metadata?.workflowStatus === 'submitted'
        || metadata?.workflowStatus === 'queued'
        || metadata?.workflowStatus === 'running';
    });
    if (pendingMessages.length === 0) {
      return undefined;
    }
    const voiceExecutionSnapshot = input.voiceCapabilityProjection?.supported && input.voiceCapabilityProjection.resolvedBinding
      ? createAISnapshot({
        config: input.aiConfig,
        capability: 'audio.synthesize',
        projection: input.voiceCapabilityProjection,
        agentResolution: input.agentResolution,
      })
      : null;
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      void (async () => {
        for (const message of pendingMessages) {
          if (cancelled) {
            return;
          }
          const result = await reconcileAgentChatVoiceWorkflowMessage({
            message,
            voiceExecutionSnapshot,
          });
          if (!result.updatedMessage || cancelled) {
            continue;
          }
          input.setBundleCache(activeThreadId, (current) => {
            if (!current) {
              return current;
            }
            return {
              ...current,
              messages: current.messages.map((item) => (
                item.id === result.updatedMessage?.id
                  ? result.updatedMessage
                  : item
              )),
            };
          });
        }
      })().catch((error) => {
        input.reportHostError(error);
      });
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [
    input.aiConfig,
    input.agentResolution,
    input.bundleMessages,
    input.activeThreadId,
    input.reportHostError,
    input.setBundleCache,
    input.voiceCapabilityProjection,
  ]);

  const resolveVoiceSessionUnavailableMessage = useCallback(() => {
    if (!input.activeTarget) {
      return input.t('Chat.voiceSessionTargetRequired', {
        defaultValue: 'Select an agent before starting voice input.',
      });
    }
    if (input.transcribeCapabilityProjection?.reasonCode === 'selection_missing' || input.transcribeCapabilityProjection?.reasonCode === 'selection_cleared') {
      return input.t('Chat.voiceSessionRouteRequired', {
        defaultValue: 'Voice input is unavailable because no transcribe route is configured.',
      });
    }
    if (input.transcribeCapabilityProjection?.reasonCode === 'route_unhealthy') {
      return input.t('Chat.voiceSessionRuntimeUnavailable', {
        defaultValue: 'Voice input is unavailable because the transcribe runtime is not ready.',
      });
    }
    if (input.transcribeCapabilityProjection?.reasonCode === 'metadata_missing' || input.transcribeCapabilityProjection?.reasonCode === 'binding_unresolved') {
      return input.t('Chat.voiceSessionRouteUnavailable', {
        defaultValue: 'Voice input is unavailable because the selected transcribe route cannot be resolved.',
      });
    }
    if (!input.transcribeCapabilityProjection?.supported || !input.transcribeCapabilityProjection?.resolvedBinding) {
      return input.t('Chat.voiceSessionUnavailable', {
        defaultValue: 'Voice input is unavailable for the current conversation.',
      });
    }
    return null;
  }, [input]);

  const resetVoiceSessionToPushToTalk = useCallback(() => {
    voiceTranscribeAbortRef.current?.abort();
    voiceTranscribeAbortRef.current = null;
    voiceCaptureSessionRef.current?.cancel();
    voiceCaptureSessionRef.current = null;
    setVoiceSessionState(createInitialAgentVoiceSessionShellState());
  }, []);

  const beginVoiceCapture = useCallback(async (params: {
    mode: AgentVoiceSessionMode;
    interruptActiveStream?: boolean;
    degradeToPushToTalkOnFailure?: boolean;
    failureDefaultMessage: string;
  }) => {
    try {
      if (params.interruptActiveStream !== false && input.activeThreadId) {
        cancelStream(input.activeThreadId);
      }
      const captureSession = await startAgentVoiceCaptureSession(
        params.mode === 'hands-free'
          ? { autoStopMode: 'silence' }
          : undefined,
      );
      voiceCaptureSessionRef.current = captureSession;
      setVoiceSessionState({
        status: 'listening',
        mode: params.mode,
        message: null,
      });
      return true;
    } catch (error) {
      const message = toErrorMessage(error, params.failureDefaultMessage);
      input.reportHostError(new Error(message, { cause: error }));
      setVoiceSessionState(
        params.degradeToPushToTalkOnFailure
          ? { status: 'failed', mode: 'push-to-talk', message }
          : { status: 'failed', mode: params.mode, message },
      );
      return false;
    }
  }, [input.activeThreadId, input.reportHostError]);

  useEffect(() => {
    if (voiceSessionState.mode !== 'hands-free' || isVoiceSessionForeground) {
      return;
    }
    resetVoiceSessionToPushToTalk();
  }, [isVoiceSessionForeground, resetVoiceSessionToPushToTalk, voiceSessionState.mode]);

  const handleVoiceSessionToggle = useCallback(() => {
    void (async () => {
      if (voiceSessionState.status === 'transcribing') {
        return;
      }
      if (voiceSessionState.status === 'listening') {
        const captureSession = voiceCaptureSessionRef.current;
        if (!captureSession) {
          setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(voiceSessionState.mode));
          return;
        }
        voiceCaptureSessionRef.current = null;
        const activeMode = voiceSessionState.mode;
        setVoiceSessionState({
          status: 'transcribing',
          mode: activeMode,
          message: null,
        });
        const abortController = new AbortController();
        voiceTranscribeAbortRef.current = abortController;
        try {
          const recording = await captureSession.stop();
          const transcribeExecutionSnapshot = input.transcribeCapabilityProjection
            ? createAISnapshot({
              config: input.aiConfig,
              capability: 'audio.transcribe',
              projection: input.transcribeCapabilityProjection,
              agentResolution: input.agentResolution,
            })
            : null;
          const result = await transcribeChatAgentVoiceRuntime({
            audioBytes: recording.bytes,
            mimeType: recording.mimeType,
            transcribeExecutionSnapshot,
            signal: abortController.signal,
          });
          if (input.activeThreadId) {
            latestVoiceCaptureByThreadRef.current[input.activeThreadId] = {
              bytes: recording.bytes,
              mimeType: recording.mimeType,
              transcriptText: result.text,
            };
          }
          await input.persistVoiceTranscriptDraft(result.text);
          if (activeMode === 'hands-free' && isVoiceSessionForeground) {
            const continued = await beginVoiceCapture({
              mode: 'hands-free',
              interruptActiveStream: false,
              degradeToPushToTalkOnFailure: true,
              failureDefaultMessage: 'Hands-free is unavailable for the current conversation.',
            });
            if (continued) {
              return;
            }
          }
          setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(activeMode));
        } catch (error) {
          if ((error as Error | null)?.name === 'AbortError') {
            setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(activeMode));
            return;
          }
          const runtimeError = toChatAgentRuntimeError(error);
          input.reportHostError(new Error(runtimeError.message, { cause: error }));
          setVoiceSessionState({
            status: 'failed',
            mode: activeMode,
            message: runtimeError.message,
          });
        } finally {
          if (voiceTranscribeAbortRef.current === abortController) {
            voiceTranscribeAbortRef.current = null;
          }
        }
        return;
      }
      if (voiceSessionState.status === 'failed') {
        setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(voiceSessionState.mode));
        return;
      }
      const unavailableMessage = resolveVoiceSessionUnavailableMessage();
      if (unavailableMessage) {
        setVoiceSessionState({
          status: 'failed',
          mode: voiceSessionState.mode,
          message: unavailableMessage,
        });
        return;
      }
      await beginVoiceCapture({
        mode: voiceSessionState.mode,
        failureDefaultMessage: 'Voice input is unavailable for the current conversation.',
      });
    })();
  }, [
    beginVoiceCapture,
    input.activeThreadId,
    input.aiConfig,
    input.agentResolution,
    input.persistVoiceTranscriptDraft,
    input.reportHostError,
    input.transcribeCapabilityProjection,
    resolveVoiceSessionUnavailableMessage,
    voiceSessionState.mode,
    voiceSessionState.status,
    isVoiceSessionForeground,
  ]);

  const handleVoiceSessionCancel = useCallback(() => {
    voiceTranscribeAbortRef.current?.abort();
    voiceTranscribeAbortRef.current = null;
    voiceCaptureSessionRef.current?.cancel();
    voiceCaptureSessionRef.current = null;
    setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(voiceSessionState.mode));
  }, [voiceSessionState.mode]);

  const handleEnterHandsFreeVoiceSession = useCallback(() => {
    void (async () => {
      if (
        voiceSessionState.mode === 'hands-free'
        || voiceSessionState.status === 'transcribing'
        || voiceSessionState.status === 'listening'
      ) {
        return;
      }
      const unavailableMessage = resolveVoiceSessionUnavailableMessage();
      if (unavailableMessage) {
        setVoiceSessionState({
          status: 'failed',
          mode: 'push-to-talk',
          message: unavailableMessage,
        });
        return;
      }
      await beginVoiceCapture({
        mode: 'hands-free',
        degradeToPushToTalkOnFailure: true,
        failureDefaultMessage: 'Hands-free is unavailable for the current conversation.',
      });
    })();
  }, [
    beginVoiceCapture,
    resolveVoiceSessionUnavailableMessage,
    voiceSessionState.mode,
    voiceSessionState.status,
  ]);

  const handleExitHandsFreeVoiceSession = useCallback(() => {
    resetVoiceSessionToPushToTalk();
  }, [resetVoiceSessionToPushToTalk]);

  const handsFreeState = useMemo(() => ({
    mode: voiceSessionState.mode,
    status: voiceSessionState.status,
    disabled: Boolean(input.submittingThreadId)
      || voiceSessionState.status === 'transcribing'
      || voiceSessionState.status === 'listening',
    onEnter: handleEnterHandsFreeVoiceSession,
    onExit: handleExitHandsFreeVoiceSession,
  }), [
    handleEnterHandsFreeVoiceSession,
    handleExitHandsFreeVoiceSession,
    input.submittingThreadId,
    voiceSessionState.mode,
    voiceSessionState.status,
  ]);

  return {
    clearLatestVoiceCaptureForThread: (threadId: string) => {
      delete latestVoiceCaptureByThreadRef.current[threadId];
    },
    handsFreeState,
    latestVoiceCaptureByThreadRef,
    onVoiceSessionCancel: handleVoiceSessionCancel,
    onVoiceSessionToggle: handleVoiceSessionToggle,
    voiceSessionState,
  };
}

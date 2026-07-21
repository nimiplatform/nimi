import {
  useCallback,
  useEffect,
  useMemo,
  type MutableRefObject,
  useRef,
  useState,
} from 'react';
import type { TFunction } from 'i18next';
import type { AgentLocalMessageRecord } from '../../bridge/runtime-bridge/types';
import { useStreamController } from '../turns/stream-controller-context.js';
import {
  createNimiConversationAISnapshot,
  type AgentEffectiveCapabilityResolution,
  type NimiAIConfig,
  type ConversationCapabilityProjection,
} from './conversation-capability';
import {
  transcribeChatAgentVoiceRuntime,
  toChatAgentRuntimeError,
} from './chat-agent-runtime';
import type { AgentVoiceCaptureSession } from './chat-agent-voice-capture';
import {
  type AgentVoiceSessionAnchorBoundReferenceAudio,
  createInitialAgentVoiceSessionShellState,
  normalizeAgentVoiceSessionConversationAnchorId,
  type AgentVoiceSessionMode,
  resolveIdleAgentVoiceSessionShellState,
  type AgentVoiceSessionShellState,
} from './chat-agent-voice-session';
import { toErrorMessage } from './chat-agent-shell-core';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import {
  resolveIsVoiceSessionForeground,
  resolveVoiceSessionUnavailableMessage,
} from './chat-agent-shell-adapter-voice-availability';

type UseAgentConversationVoiceSessionInput = {
  activeTarget: { localAgentRef: string } | null;
  activeConversationAnchorId: string | null;
  activeThreadId: string | null;
  aiConfig: NimiAIConfig;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  bundleMessages: readonly AgentLocalMessageRecord[] | undefined;
  applyVoiceTranscriptComposerText: (input: { text: string; conversationAnchorId: string }) => Promise<void>;
  reportHostError: (error: unknown) => void;
  setBundleCache: (
    threadId: string,
    updater: (current: import('../../bridge/runtime-bridge/types').AgentLocalThreadBundle | null | undefined) =>
      import('../../bridge/runtime-bridge/types').AgentLocalThreadBundle | null | undefined,
  ) => void;
  submittingThreadId: string | null;
  t: TFunction;
  transcribeCapabilityProjection: ConversationCapabilityProjection | null;
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
  latestVoiceCaptureByThreadRef: MutableRefObject<Record<string, AgentVoiceSessionAnchorBoundReferenceAudio | undefined>>;
  onVoiceSessionCancel: () => void;
  onVoiceSessionToggle: () => void;
  voiceCaptureState: {
    active: boolean;
    amplitude: number;
  } | null;
  voiceSessionState: AgentVoiceSessionShellState;
} {
  const streamController = useStreamController();
  const bindings = useDesktopRendererBindings();
  const sdk = bindings.sdk;
  const [voiceSessionState, setVoiceSessionState] = useState<AgentVoiceSessionShellState>(
    () => createInitialAgentVoiceSessionShellState(),
  );
  const [isVoiceSessionForeground, setIsVoiceSessionForeground] = useState<boolean>(
    () => resolveIsVoiceSessionForeground({
      documentVisible: bindings.app.projection.documentVisible(),
      windowFocused: bindings.app.projection.windowFocused(),
    }),
  );
  const latestVoiceCaptureByThreadRef = useRef<Record<string, AgentVoiceSessionAnchorBoundReferenceAudio | undefined>>({});
  const voiceCaptureSessionRef = useRef<AgentVoiceCaptureSession | null>(null);
  const voiceTranscribeAbortRef = useRef<AbortController | null>(null);
  const [voiceCaptureState, setVoiceCaptureState] = useState<{
    active: boolean;
    amplitude: number;
  } | null>(null);

  useEffect(() => {
    const resetVoiceSession = () => {
      voiceTranscribeAbortRef.current?.abort();
      voiceTranscribeAbortRef.current = null;
      voiceCaptureSessionRef.current?.cancel();
      voiceCaptureSessionRef.current = null;
      setVoiceCaptureState(null);
      setVoiceSessionState(createInitialAgentVoiceSessionShellState());
    };
    resetVoiceSession();
    return resetVoiceSession;
  }, [input.activeConversationAnchorId, input.activeTarget?.localAgentRef, input.activeThreadId]);

  useEffect(() => {
    const syncForegroundState = () => {
      setIsVoiceSessionForeground(resolveIsVoiceSessionForeground({
        documentVisible: bindings.app.projection.documentVisible(),
        windowFocused: bindings.app.projection.windowFocused(),
      }));
    };
    syncForegroundState();
    const unsubscribeVisibility = bindings.app.events.subscribeDocumentVisibility(syncForegroundState);
    const unsubscribeFocus = bindings.app.events.subscribeWindowFocus(syncForegroundState);
    return () => {
      unsubscribeVisibility();
      unsubscribeFocus();
    };
  }, [bindings]);

  const resolveUnavailableMessage = useCallback(() => resolveVoiceSessionUnavailableMessage(input), [input]);

  const resetVoiceSessionToPushToTalk = useCallback(() => {
    voiceTranscribeAbortRef.current?.abort();
    voiceTranscribeAbortRef.current = null;
    voiceCaptureSessionRef.current?.cancel();
    voiceCaptureSessionRef.current = null;
    setVoiceSessionState(createInitialAgentVoiceSessionShellState());
  }, []);

  const handleHandsFreeAutoStopRecording = useCallback((
    recordingPromise: ReturnType<AgentVoiceCaptureSession['stop']>,
    sessionAnchorId: string,
  ) => {
    const activeConversationAnchorId = normalizeAgentVoiceSessionConversationAnchorId(input.activeConversationAnchorId);
    if (!sessionAnchorId || sessionAnchorId !== activeConversationAnchorId) {
      void recordingPromise.catch((error) => {
        input.reportHostError(new Error(toErrorMessage(error, 'Voice input stop failed.'), { cause: error }));
      });
      setVoiceCaptureState(null);
      setVoiceSessionState({
        status: 'failed',
        mode: 'hands-free',
        conversationAnchorId: activeConversationAnchorId,
        message: input.t('Chat.voiceSessionAnchorChanged', {
          defaultValue: 'Voice input stopped because the conversation anchor changed.',
        }),
      });
      return;
    }
    const abortController = new AbortController();
    voiceTranscribeAbortRef.current?.abort();
    voiceTranscribeAbortRef.current = abortController;
    setVoiceCaptureState(null);
    setVoiceSessionState({
      status: 'transcribing',
      mode: 'hands-free',
      conversationAnchorId: sessionAnchorId,
      message: null,
    });
    void (async () => {
      try {
        const recording = await recordingPromise;
        const transcribeExecutionSnapshot = input.transcribeCapabilityProjection
          ? createNimiConversationAISnapshot({
            config: input.aiConfig,
            capability: 'audio.transcribe',
            projection: input.transcribeCapabilityProjection,
            agentResolution: input.agentResolution,
            createdAtMs: bindings.clock.now(),
          })
          : null;
        const result = await transcribeChatAgentVoiceRuntime({
          audioBytes: recording.bytes,
          mimeType: recording.mimeType,
          transcribeExecutionSnapshot,
          signal: abortController.signal,
        }, {
          buildRuntimeCallOptionsImpl: sdk.runtimeRouteAccess().buildCallOptions,
          getRuntimeImpl: sdk.runtime,
          getAppIdImpl: sdk.appId,
        });
        if (input.activeThreadId) {
          latestVoiceCaptureByThreadRef.current[input.activeThreadId] = {
            conversationAnchorId: sessionAnchorId,
            bytes: recording.bytes,
            mimeType: recording.mimeType,
            transcriptText: result.text,
          };
        }
        await input.applyVoiceTranscriptComposerText({
          text: result.text,
          conversationAnchorId: sessionAnchorId,
        });
        setVoiceSessionState(resolveIdleAgentVoiceSessionShellState('hands-free'));
      } catch (error) {
        if ((error as Error | null)?.name === 'AbortError') {
          setVoiceSessionState(resolveIdleAgentVoiceSessionShellState('hands-free'));
          return;
        }
        const runtimeError = toChatAgentRuntimeError(error, input.t);
        input.reportHostError(new Error(runtimeError.message, { cause: error }));
        setVoiceSessionState({
          status: 'failed',
          mode: 'hands-free',
          conversationAnchorId: sessionAnchorId,
          message: runtimeError.message,
        });
      } finally {
        if (voiceTranscribeAbortRef.current === abortController) {
          voiceTranscribeAbortRef.current = null;
        }
      }
    })();
  }, [
    input.activeConversationAnchorId,
    input.activeThreadId,
    input.agentResolution,
    input.aiConfig,
    input.applyVoiceTranscriptComposerText,
    input.reportHostError,
    input.t,
    input.transcribeCapabilityProjection,
  ]);

  const beginVoiceCapture = useCallback(async (params: {
    mode: AgentVoiceSessionMode;
    interruptActiveStream?: boolean;
    degradeToPushToTalkOnFailure?: boolean;
    failureDefaultMessage: string;
  }) => {
    try {
      const activeThreadId = input.activeThreadId;
      const conversationAnchorId = normalizeAgentVoiceSessionConversationAnchorId(input.activeConversationAnchorId);
      if (!activeThreadId || !conversationAnchorId) {
        const message = input.t('Chat.voiceSessionAnchorRequired', {
          defaultValue: 'Voice input is unavailable because the conversation anchor is not ready.',
        });
        setVoiceSessionState({
          status: 'failed',
          mode: params.degradeToPushToTalkOnFailure ? 'push-to-talk' : params.mode,
          conversationAnchorId,
          message,
        });
        return false;
      }
      if (params.interruptActiveStream !== false) {
        streamController.cancelStream(activeThreadId);
      }
      const captureSession = await bindings.app.commands.voiceCapture.start(
        params.mode === 'hands-free'
          ? {
            autoStopMode: 'silence',
            onAutoStop: (recording) => {
              voiceCaptureSessionRef.current = null;
              setVoiceCaptureState(null);
              handleHandsFreeAutoStopRecording(recording, conversationAnchorId);
            },
            onLevelChange: (amplitude) => {
              setVoiceCaptureState({
                active: true,
                amplitude,
              });
            },
          }
          : {
            onLevelChange: (amplitude) => {
              setVoiceCaptureState({
                active: true,
                amplitude,
              });
            },
          },
      );
      voiceCaptureSessionRef.current = captureSession;
      setVoiceSessionState({
        status: 'listening',
        mode: params.mode,
        conversationAnchorId,
        message: null,
      });
      return true;
    } catch (error) {
      const message = toErrorMessage(error, params.failureDefaultMessage);
      input.reportHostError(new Error(message, { cause: error }));
      setVoiceSessionState(
        params.degradeToPushToTalkOnFailure
          ? {
            status: 'failed',
            mode: 'push-to-talk',
            conversationAnchorId: normalizeAgentVoiceSessionConversationAnchorId(input.activeConversationAnchorId),
            message,
          }
          : {
            status: 'failed',
            mode: params.mode,
            conversationAnchorId: normalizeAgentVoiceSessionConversationAnchorId(input.activeConversationAnchorId),
            message,
          },
      );
      return false;
    }
  }, [
    handleHandsFreeAutoStopRecording,
    input.activeConversationAnchorId,
    input.activeThreadId,
    input.reportHostError,
    input.t,
    streamController,
  ]);

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
          setVoiceCaptureState(null);
          setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(voiceSessionState.mode));
          return;
        }
        const sessionAnchorId = voiceSessionState.conversationAnchorId;
        const activeConversationAnchorId = normalizeAgentVoiceSessionConversationAnchorId(input.activeConversationAnchorId);
        if (!sessionAnchorId || sessionAnchorId !== activeConversationAnchorId) {
          voiceCaptureSessionRef.current = null;
          captureSession.cancel();
          setVoiceCaptureState(null);
          setVoiceSessionState({
            status: 'failed',
            mode: voiceSessionState.mode,
            conversationAnchorId: activeConversationAnchorId,
            message: input.t('Chat.voiceSessionAnchorChanged', {
              defaultValue: 'Voice input stopped because the conversation anchor changed.',
            }),
          });
          return;
        }
        voiceCaptureSessionRef.current = null;
        setVoiceCaptureState(null);
        const activeMode = voiceSessionState.mode;
        setVoiceSessionState({
          status: 'transcribing',
          mode: activeMode,
          conversationAnchorId: sessionAnchorId,
          message: null,
        });
        const abortController = new AbortController();
        voiceTranscribeAbortRef.current = abortController;
        try {
          const recording = await captureSession.stop();
          const transcribeExecutionSnapshot = input.transcribeCapabilityProjection
            ? createNimiConversationAISnapshot({
              config: input.aiConfig,
              capability: 'audio.transcribe',
              projection: input.transcribeCapabilityProjection,
              agentResolution: input.agentResolution,
              createdAtMs: bindings.clock.now(),
            })
            : null;
          const result = await transcribeChatAgentVoiceRuntime({
            audioBytes: recording.bytes,
            mimeType: recording.mimeType,
            transcribeExecutionSnapshot,
            signal: abortController.signal,
          }, {
            buildRuntimeCallOptionsImpl: sdk.runtimeRouteAccess().buildCallOptions,
            getRuntimeImpl: sdk.runtime,
            getAppIdImpl: sdk.appId,
          });
          if (input.activeThreadId) {
            latestVoiceCaptureByThreadRef.current[input.activeThreadId] = {
              conversationAnchorId: sessionAnchorId,
              bytes: recording.bytes,
              mimeType: recording.mimeType,
              transcriptText: result.text,
            };
          }
          await input.applyVoiceTranscriptComposerText({
            text: result.text,
            conversationAnchorId: sessionAnchorId,
          });
          if (
            activeMode === 'hands-free'
            && isVoiceSessionForeground
            && sessionAnchorId === normalizeAgentVoiceSessionConversationAnchorId(input.activeConversationAnchorId)
          ) {
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
          setVoiceCaptureState(null);
          setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(activeMode));
        } catch (error) {
          setVoiceCaptureState(null);
          if ((error as Error | null)?.name === 'AbortError') {
            setVoiceSessionState(resolveIdleAgentVoiceSessionShellState(activeMode));
            return;
          }
          const runtimeError = toChatAgentRuntimeError(error, input.t);
          input.reportHostError(new Error(runtimeError.message, { cause: error }));
          setVoiceSessionState({
            status: 'failed',
            mode: activeMode,
            conversationAnchorId: sessionAnchorId,
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
      const unavailableMessage = resolveUnavailableMessage();
      if (unavailableMessage) {
        setVoiceSessionState({
          status: 'failed',
          mode: voiceSessionState.mode,
          conversationAnchorId: normalizeAgentVoiceSessionConversationAnchorId(input.activeConversationAnchorId),
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
    input.activeConversationAnchorId,
    input.activeThreadId,
    input.aiConfig,
    input.agentResolution,
    input.applyVoiceTranscriptComposerText,
    input.reportHostError,
    input.t,
    input.transcribeCapabilityProjection,
    resolveUnavailableMessage,
    voiceSessionState.mode,
    voiceSessionState.conversationAnchorId,
    voiceSessionState.status,
    isVoiceSessionForeground,
  ]);

  const handleVoiceSessionCancel = useCallback(() => {
    voiceTranscribeAbortRef.current?.abort();
    voiceTranscribeAbortRef.current = null;
    voiceCaptureSessionRef.current?.cancel();
    voiceCaptureSessionRef.current = null;
    setVoiceCaptureState(null);
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
      const unavailableMessage = resolveUnavailableMessage();
      if (unavailableMessage) {
        setVoiceSessionState({
          status: 'failed',
          mode: 'push-to-talk',
          conversationAnchorId: normalizeAgentVoiceSessionConversationAnchorId(input.activeConversationAnchorId),
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
    input.activeConversationAnchorId,
    resolveUnavailableMessage,
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
    voiceCaptureState,
    voiceSessionState,
  };
}

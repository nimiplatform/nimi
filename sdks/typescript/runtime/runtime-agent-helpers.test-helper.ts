import type {
  AgentEvent,
  AgentVoiceStreamEvent,
  GetAgentRequest,
  InitializeAgentRequest,
  InterruptAgentVoicePlaybackRequest,
  InterruptAgentVoicePlaybackResponse,
  ReadArtifactBytesRequest,
  ReadArtifactBytesResponse,
  type AppMessageEvent,
  RuntimeTypedCallOptions,
  SendAppMessageRequest,
  SubscribeAgentEventsRequest,
  SubscribeAppMessagesRequest,
  SubscribeAgentVoiceStreamRequest,
  TerminateAgentRequest,
} from '../core-generated/runtime-typed-client';
import {
  AgentEventType,
  AgentLifecycleStatus,
  AgentPresentationEventFamily,
  ReasonCode as RuntimeGeneratedReasonCode,
  VoiceOutputMode,
  VoicePlaybackState,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode as SdkReasonCode } from '../types';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
} from './runtime-agent-lifecycle';
import {
  buildNimiRuntimeAgentTurnPayload,
  createNimiRuntimeAgentTurnsModule,
} from './runtime-agent-turns';
import { createNimiRuntimeAgentVoiceModule } from './runtime-agent-voice';
import { fromNimiRuntimeProtoStruct, toNimiRuntimeProtoStruct, toNimiRuntimeTimestamp } from './runtime-agent-values';

export type {
  AgentEvent,
  AgentVoiceStreamEvent,
  GetAgentRequest,
  InitializeAgentRequest,
  InterruptAgentVoicePlaybackRequest,
  InterruptAgentVoicePlaybackResponse,
  ReadArtifactBytesRequest,
  ReadArtifactBytesResponse,
  AppMessageEvent,
  RuntimeTypedCallOptions,
  SendAppMessageRequest,
  SubscribeAgentEventsRequest,
  SubscribeAppMessagesRequest,
  SubscribeAgentVoiceStreamRequest,
  TerminateAgentRequest,
};

export {
  AgentEventType,
  AgentLifecycleStatus,
  AgentPresentationEventFamily,
  RuntimeGeneratedReasonCode,
  VoiceOutputMode,
  VoicePlaybackState,
  SdkReasonCode,
  buildNimiRuntimeAgentTurnPayload,
  createNimiError,
  createNimiHostRuntimeAgentLifecycleSurface,
  createNimiRuntimeAgentTurnsModule,
  createNimiRuntimeAgentVoiceModule,
  fromNimiRuntimeProtoStruct,
  toNimiRuntimeProtoStruct,
  toNimiRuntimeTimestamp,
};

export const OWNER_USER_ID = 'user-1';
export const RUNTIME_SOURCE_REF = 'agent-1';
export const LOCAL_AGENT_REF = 'local-agent:test-user-1-agent-1';

export function voicePlaybackRequestedAgentEvent(input: {
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly streamId: string;
  readonly messageId: string;
  readonly audioArtifactId: string;
  readonly audioMimeType: string;
  readonly playbackTarget: string;
}): AgentEvent {
  return {
    eventType: AgentEventType.PRESENTATION,
    sequence: '20',
    agentId: LOCAL_AGENT_REF,
    localAgentRef: LOCAL_AGENT_REF,
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    timestamp: toNimiRuntimeTimestamp(Date.now()),
    detail: {
      oneofKind: 'presentation',
      presentation: {
        family: AgentPresentationEventFamily.VOICE_PLAYBACK_REQUESTED,
        conversationAnchorId: input.conversationAnchorId,
        turnId: input.turnId,
        streamId: input.streamId,
        activityName: '',
        activityCategory: '',
        activityIntensity: '',
        activitySource: '',
        motionId: '',
        motionPriority: '',
        motionExpectedDurationMs: '0',
        expressionId: '',
        expressionExpectedDurationMs: '0',
        poseId: '',
        poseExpectedDurationMs: '0',
        previousPoseId: '',
        lookatTargetKind: '',
        lookatX: 0,
        lookatY: 0,
        lookatZ: 0,
        lookatHasX: false,
        lookatHasY: false,
        lookatHasZ: false,
        audioArtifactId: input.audioArtifactId,
        audioMimeType: input.audioMimeType,
        voiceStreamId: '',
        chunkTransportRef: '',
        messageId: input.messageId,
        chunkSequence: '0',
        finalChunk: true,
        voiceOutputMode: VoiceOutputMode.BATCH_FINAL_ARTIFACT,
        voicePlaybackState: VoicePlaybackState.ACTIVE,
        playbackTarget: input.playbackTarget,
        finalArtifact: true,
        terminalReason: '',
        reason: 'manual_render_requested',
        durationMs: '1000',
        deadlineOffsetMs: '0',
        finalArtifactId: '',
      },
    },
  };
}

export class CancellableStream<T> implements AsyncIterable<T> {
  private readonly values: T[];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  returnCount = 0;

  constructor(values: readonly T[]) {
    this.values = [...values];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        if (this.values.length > 0) {
          return { done: false, value: this.values.shift() as T };
        }
        if (this.closed) {
          return { done: true, value: undefined };
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
      return: async () => {
        this.returnCount += 1;
        this.closed = true;
        this.values.length = 0;
        while (this.waiters.length > 0) {
          this.waiters.shift()?.({ done: true, value: undefined });
        }
        return { done: true, value: undefined };
      },
    };
  }
}

export function trackedPendingStream<T>(hooks: {
  readonly onNext: () => void;
  readonly onReturn: () => void;
}): AsyncIterable<T> {
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: async () => {
          hooks.onNext();
          if (closed) {
            return { done: true, value: undefined };
          }
          return new Promise<IteratorResult<T>>((resolve) => {
            waiters.push(resolve);
          });
        },
        return: async () => {
          closed = true;
          hooks.onReturn();
          while (waiters.length > 0) {
            waiters.shift()?.({ done: true, value: undefined });
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

export function agentIdentity() {
  return {
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
  };
}

export function protectedAuth() {
  return {
    async registerApp() {
      return { accepted: true };
    },
  };
}

export function protectedAppAuth() {
  return {
    async authorizeExternalPrincipal() {
      return { tokenId: 'token-1', secret: 'secret-1' };
    },
  };
}
